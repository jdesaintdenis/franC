import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { db as dbClient } from "../client";
import { normalizeLabel } from "../../lib/import/normalize-label";
import {
  compileMerchantPatterns,
  matchesMerchantPattern,
  resolveMerchant,
  type MerchantMatchType,
} from "../../lib/merchants/match";
import { merchantPatterns, merchants, transactions, type Merchant, type MerchantPattern } from "../schema";
import { applyRulesInTransaction } from "./category-rules";

const CHUNK_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

type Selectable = Pick<typeof dbClient, "select">;
type Executor = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];

/** Codes, not user text: the UI translates them. */
export type MerchantWriteError = "not_found" | "name_taken" | "pattern_exists";

export interface PatternInput {
  matchType: MerchantMatchType;
  pattern: string;
}

/** What a merchant change did to the user's data (all inside the mutation's transaction). */
export interface MerchantChangeEffects {
  /** Transactions whose merchant name changed. */
  rowsRenamed: number;
  /** Transactions the rules categorized because of the change. */
  rowsCategorized: number;
}

export type MerchantWriteResult<T> = ({ ok: true } & T & MerchantChangeEffects) | { ok: false; error: MerchantWriteError };

export interface MerchantListItem {
  id: string;
  name: string;
  createdAt: Date;
  /** Transactions currently carrying this name. */
  transactionCount: number;
  /** Oldest first. */
  patterns: MerchantPattern[];
}

/** The user's merchants by name (case-insensitive), with their patterns and transaction counts. */
export async function listMerchants(database: Selectable, userId: string): Promise<MerchantListItem[]> {
  const merchantRows = await database
    .select()
    .from(merchants)
    .where(eq(merchants.userId, userId))
    .orderBy(asc(sql`lower(${merchants.name})`), asc(merchants.id));
  if (merchantRows.length === 0) return [];

  const patternRows = await database
    .select()
    .from(merchantPatterns)
    .where(eq(merchantPatterns.userId, userId))
    .orderBy(asc(merchantPatterns.createdAt), asc(merchantPatterns.id));
  const counts = await database
    .select({ merchantId: transactions.merchantId, total: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), sql`${transactions.merchantId} is not null`))
    .groupBy(transactions.merchantId);
  const countById = new Map(counts.map((c) => [c.merchantId, c.total]));

  return merchantRows.map((m) => ({
    id: m.id,
    name: m.name,
    createdAt: m.createdAt,
    transactionCount: countById.get(m.id) ?? 0,
    patterns: patternRows.filter((p) => p.merchantId === m.id),
  }));
}

/**
 * How many of the user's transactions a pattern would match (raw or simplified label),
 * for the live "Renames N transactions" line. Counts distinct labels in SQL and matches
 * them in JS with the same matcher as the recompute.
 */
export async function countPatternMatches(
  database: Selectable,
  userId: string,
  matchType: MerchantMatchType,
  pattern: string,
): Promise<number> {
  if (normalizeLabel(pattern) === "") return 0;
  const rows = await database
    .select({
      normalized: transactions.labelNormalized,
      display: transactions.labelDisplay,
      total: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .groupBy(transactions.labelNormalized, transactions.labelDisplay);
  let total = 0;
  for (const row of rows) {
    if (matchesMerchantPattern({ matchType, pattern }, row)) total += row.total;
  }
  return total;
}

/** Loads the user's patterns and compiles them once (import and recompute). */
export async function loadCompiledMerchantPatterns(database: Selectable, userId: string) {
  const rows = await database
    .select({
      merchantId: merchantPatterns.merchantId,
      matchType: merchantPatterns.matchType,
      pattern: merchantPatterns.pattern,
      createdAt: merchantPatterns.createdAt,
    })
    .from(merchantPatterns)
    .where(eq(merchantPatterns.userId, userId));
  return compileMerchantPatterns(rows);
}

/** id -> name of the user's merchants. */
export async function loadMerchantNames(database: Selectable, userId: string): Promise<Map<string, string>> {
  const rows = await database
    .select({ id: merchants.id, name: merchants.name })
    .from(merchants)
    .where(eq(merchants.userId, userId));
  return new Map(rows.map((m) => [m.id, m.name]));
}

export interface MerchantLookup {
  patterns: ReturnType<typeof compileMerchantPatterns>;
  names: Map<string, string>;
}

/** Compiled patterns plus id -> name, for callers that name rows outside the recompute (import, its preview). */
export async function loadMerchantLookup(database: Selectable, userId: string): Promise<MerchantLookup> {
  const patterns = await loadCompiledMerchantPatterns(database, userId);
  if (patterns.length === 0) return { patterns, names: new Map() };
  return { patterns, names: await loadMerchantNames(database, userId) };
}

/**
 * Re-matches every one of the user's transactions against their patterns and writes only
 * the rows whose merchant changed. Never reads or writes another user's rows or patterns.
 * Returns the number of rows changed.
 */
export async function recomputeMerchants(
  tx: Pick<typeof dbClient, "select" | "update">,
  userId: string,
): Promise<number> {
  const compiled = await loadCompiledMerchantPatterns(tx, userId);
  const rows = await tx
    .select({
      id: transactions.id,
      normalized: transactions.labelNormalized,
      display: transactions.labelDisplay,
      merchantId: transactions.merchantId,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId));

  // New merchant id (or null) -> rows to write.
  const changes = new Map<string | null, string[]>();
  let changed = 0;
  for (const row of rows) {
    const next = resolveMerchant(compiled, row);
    if (next === row.merchantId) continue;
    const ids = changes.get(next) ?? [];
    ids.push(row.id);
    changes.set(next, ids);
    changed++;
  }

  for (const [merchantId, ids] of changes) {
    for (const part of chunk(ids, CHUNK_SIZE)) {
      await tx
        .update(transactions)
        .set({ merchantId })
        .where(and(eq(transactions.userId, userId), inArray(transactions.id, part)));
    }
  }
  return changed;
}

/** Mutation -> recompute -> rules on uncategorized/bank rows; the caller's transaction holds all of it. */
async function applyMerchantChange(tx: Executor, userId: string, recompute: boolean): Promise<MerchantChangeEffects> {
  const rowsRenamed = recompute ? await recomputeMerchants(tx, userId) : 0;
  const rules = await applyRulesInTransaction(tx, userId);
  return { rowsRenamed, rowsCategorized: rules.updated };
}

async function getOwnedMerchant(tx: Selectable, userId: string, merchantId: string): Promise<Merchant | null> {
  const [row] = await tx
    .select()
    .from(merchants)
    .where(and(eq(merchants.id, merchantId), eq(merchants.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function findByName(tx: Selectable, userId: string, name: string): Promise<Merchant | null> {
  const [row] = await tx
    .select()
    .from(merchants)
    .where(and(eq(merchants.userId, userId), sql`lower(${merchants.name}) = lower(${name})`))
    .limit(1);
  return row ?? null;
}

async function patternExists(tx: Selectable, userId: string, merchantId: string, input: PatternInput): Promise<boolean> {
  const rows = await tx
    .select({ pattern: merchantPatterns.pattern })
    .from(merchantPatterns)
    .where(
      and(
        eq(merchantPatterns.userId, userId),
        eq(merchantPatterns.merchantId, merchantId),
        eq(merchantPatterns.matchType, input.matchType),
      ),
    );
  const wanted = normalizeLabel(input.pattern);
  return rows.some((r) => normalizeLabel(r.pattern) === wanted);
}

/**
 * Creates a merchant with its first pattern. When the user already has a merchant with this
 * name (ignoring case), the pattern is added to it instead (`created` is false); the same
 * pattern twice on one merchant is `pattern_exists`. `input` must already be validated
 * (lib/merchants/input).
 */
export async function createMerchant(
  database: typeof dbClient,
  userId: string,
  input: { name: string } & PatternInput,
): Promise<MerchantWriteResult<{ merchant: Merchant; patternId: string; created: boolean }>> {
  return database.transaction(async (tx) => {
    let merchant = await findByName(tx, userId, input.name);
    const created = merchant === null;
    if (merchant && (await patternExists(tx, userId, merchant.id, input))) {
      return { ok: false, error: "pattern_exists" } as const;
    }
    if (!merchant) {
      [merchant] = await tx.insert(merchants).values({ userId, name: input.name }).returning();
    }
    const [pattern] = await tx
      .insert(merchantPatterns)
      .values({ userId, merchantId: merchant.id, matchType: input.matchType, pattern: input.pattern })
      .returning({ id: merchantPatterns.id });
    const effects = await applyMerchantChange(tx, userId, true);
    return { ok: true, merchant, patternId: pattern.id, created, ...effects } as const;
  });
}

/** Renames a merchant. Rows keep pointing at it by id, so only rules (which see the name) re-run. */
export async function renameMerchant(
  database: typeof dbClient,
  userId: string,
  merchantId: string,
  name: string,
): Promise<MerchantWriteResult<{ merchant: Merchant }>> {
  return database.transaction(async (tx) => {
    const current = await getOwnedMerchant(tx, userId, merchantId);
    if (!current) return { ok: false, error: "not_found" } as const;
    const clash = await findByName(tx, userId, name);
    if (clash && clash.id !== merchantId) return { ok: false, error: "name_taken" } as const;
    const [merchant] = await tx
      .update(merchants)
      .set({ name })
      .where(and(eq(merchants.id, merchantId), eq(merchants.userId, userId)))
      .returning();
    const effects = await applyMerchantChange(tx, userId, false);
    return { ok: true, merchant, ...effects } as const;
  });
}

export async function addMerchantPattern(
  database: typeof dbClient,
  userId: string,
  merchantId: string,
  input: PatternInput,
): Promise<MerchantWriteResult<{ pattern: MerchantPattern }>> {
  return database.transaction(async (tx) => {
    if (!(await getOwnedMerchant(tx, userId, merchantId))) return { ok: false, error: "not_found" } as const;
    if (await patternExists(tx, userId, merchantId, input)) return { ok: false, error: "pattern_exists" } as const;
    const [pattern] = await tx
      .insert(merchantPatterns)
      .values({ userId, merchantId, matchType: input.matchType, pattern: input.pattern })
      .returning();
    const effects = await applyMerchantChange(tx, userId, true);
    return { ok: true, pattern, ...effects } as const;
  });
}

export async function removeMerchantPattern(
  database: typeof dbClient,
  userId: string,
  patternId: string,
): Promise<MerchantWriteResult<Record<never, never>>> {
  return database.transaction(async (tx) => {
    const removed = await tx
      .delete(merchantPatterns)
      .where(and(eq(merchantPatterns.id, patternId), eq(merchantPatterns.userId, userId)))
      .returning({ id: merchantPatterns.id });
    if (removed.length === 0) return { ok: false, error: "not_found" } as const;
    const effects = await applyMerchantChange(tx, userId, true);
    return { ok: true, ...effects } as const;
  });
}

/** What Undo needs to bring a deleted merchant back (dates are ISO strings: it travels through the client). */
export interface MerchantSnapshot {
  id: string;
  name: string;
  createdAt: string;
  patterns: { id: string; matchType: MerchantMatchType; pattern: string; createdAt: string }[];
}

/** Deletes a merchant and its patterns; its rows go back to the bank's label (or another merchant that matches). */
export async function deleteMerchant(
  database: typeof dbClient,
  userId: string,
  merchantId: string,
): Promise<MerchantWriteResult<{ snapshot: MerchantSnapshot }>> {
  return database.transaction(async (tx) => {
    const merchant = await getOwnedMerchant(tx, userId, merchantId);
    if (!merchant) return { ok: false, error: "not_found" } as const;
    const patterns = await tx
      .select()
      .from(merchantPatterns)
      .where(and(eq(merchantPatterns.userId, userId), eq(merchantPatterns.merchantId, merchantId)))
      .orderBy(asc(merchantPatterns.createdAt), asc(merchantPatterns.id));
    await tx.delete(merchants).where(and(eq(merchants.id, merchantId), eq(merchants.userId, userId)));
    const effects = await applyMerchantChange(tx, userId, true);
    const snapshot: MerchantSnapshot = {
      id: merchant.id,
      name: merchant.name,
      createdAt: merchant.createdAt.toISOString(),
      patterns: patterns.map((p) => ({
        id: p.id,
        matchType: p.matchType,
        pattern: p.pattern,
        createdAt: p.createdAt.toISOString(),
      })),
    };
    return { ok: true, snapshot, ...effects } as const;
  });
}

/**
 * Undo of `deleteMerchant`: recreates the merchant and its patterns with their old ids, then
 * runs the same re-match so the rows get their name back. Refuses when the name is taken
 * again, or when the id belongs to someone else. `snapshot` must already be validated.
 */
export async function restoreMerchant(
  database: typeof dbClient,
  userId: string,
  snapshot: MerchantSnapshot,
): Promise<MerchantWriteResult<{ merchant: Merchant }>> {
  return database.transaction(async (tx) => {
    if (await findByName(tx, userId, snapshot.name)) return { ok: false, error: "name_taken" } as const;
    const [merchant] = await tx
      .insert(merchants)
      .values({ id: snapshot.id, userId, name: snapshot.name, createdAt: new Date(snapshot.createdAt) })
      .onConflictDoNothing()
      .returning();
    // The id exists already (another user's, or restored twice): nothing to bring back.
    if (!merchant) return { ok: false, error: "not_found" } as const;
    if (snapshot.patterns.length > 0) {
      await tx.insert(merchantPatterns).values(
        snapshot.patterns.map((p) => ({
          id: p.id,
          userId,
          merchantId: merchant.id,
          matchType: p.matchType,
          pattern: p.pattern,
          createdAt: new Date(p.createdAt),
        })),
      );
    }
    const effects = await applyMerchantChange(tx, userId, true);
    return { ok: true, merchant, ...effects } as const;
  });
}
