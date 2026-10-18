import { and, eq, inArray, or, sql } from "drizzle-orm";

import { MAX_TAGS_PER_TRANSACTION, MAX_TAGS_PER_USER } from "../../lib/tags/validate";
import type { db as dbClient } from "../client";
import { tags, transactions, transactionTags } from "../schema";

type Selectable = Pick<typeof dbClient, "select">;
type Executor = Pick<typeof dbClient, "select" | "insert" | "update" | "delete">;

export interface TagRef {
  id: string;
  name: string;
}

export interface TagWithCount extends TagRef {
  /** Number of the user's transactions carrying the tag. */
  transactionCount: number;
}

export type TagWriteCode = "tooManyTags" | "tooManyUserTags" | "notFound";

/** Case-insensitive name order, ties broken by the exact name. */
function byName(a: TagRef, b: TagRef): number {
  const la = a.name.toLowerCase();
  const lb = b.name.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** The user's tags with their number of transactions, sorted by name (case-insensitive). */
export async function listTags(database: Selectable, userId: string): Promise<TagWithCount[]> {
  const rows = await database
    .select({
      id: tags.id,
      name: tags.name,
      transactionCount: sql<number>`count(${transactionTags.tagId})::int`,
    })
    .from(tags)
    .leftJoin(transactionTags, and(eq(transactionTags.tagId, tags.id), eq(transactionTags.userId, userId)))
    .where(eq(tags.userId, userId))
    .groupBy(tags.id, tags.name);
  return rows.sort(byName);
}

/**
 * Tags of a page of transactions, keyed by transaction id and sorted by name. Scoped by
 * user_id on both the links and the tags.
 */
export async function loadTransactionTags(
  database: Selectable,
  userId: string,
  transactionIds: string[],
): Promise<Map<string, TagRef[]>> {
  const result = new Map<string, TagRef[]>();
  if (transactionIds.length === 0) return result;
  const rows = await database
    .select({ transactionId: transactionTags.transactionId, id: tags.id, name: tags.name })
    .from(transactionTags)
    .innerJoin(tags, and(eq(tags.id, transactionTags.tagId), eq(tags.userId, userId)))
    .where(and(eq(transactionTags.userId, userId), inArray(transactionTags.transactionId, transactionIds)));
  for (const r of rows) {
    const list = result.get(r.transactionId) ?? [];
    list.push({ id: r.id, name: r.name });
    result.set(r.transactionId, list);
  }
  for (const list of result.values()) list.sort(byName);
  return result;
}

function lowerNames(names: string[]): string[] {
  return [...new Set(names.map((n) => n.toLowerCase()))];
}

async function findTagsByName(database: Selectable, userId: string, names: string[]): Promise<TagRef[]> {
  const lowers = lowerNames(names);
  if (lowers.length === 0) return [];
  return database
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.userId, userId), inArray(sql`lower(${tags.name})`, lowers)));
}

/**
 * Finds the user's tags by (already normalized) name, case-insensitively, creating the missing
 * ones. Creating stops at the per-user cap. Call inside a DB transaction when more writes follow.
 */
export async function getOrCreateTags(
  database: Executor,
  userId: string,
  names: string[],
): Promise<{ ok: true; tags: TagRef[] } | { ok: false; code: "tooManyUserTags" }> {
  const wanted = new Map<string, string>();
  for (const n of names) if (!wanted.has(n.toLowerCase())) wanted.set(n.toLowerCase(), n);
  if (wanted.size === 0) return { ok: true, tags: [] };

  const existing = await findTagsByName(database, userId, names);
  const known = new Set(existing.map((t) => t.name.toLowerCase()));
  const missing = [...wanted].filter(([lower]) => !known.has(lower)).map(([, name]) => name);
  if (missing.length === 0) return { ok: true, tags: existing };

  const [count] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(tags)
    .where(eq(tags.userId, userId));
  if ((count?.total ?? 0) + missing.length > MAX_TAGS_PER_USER) return { ok: false, code: "tooManyUserTags" };

  // A concurrent insert of the same name is a no-op here; the re-read below finds it.
  await database
    .insert(tags)
    .values(missing.map((name) => ({ userId, name })))
    .onConflictDoNothing();
  return { ok: true, tags: await findTagsByName(database, userId, names) };
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let i = 0; i < 3 && typeof current === "object" && current !== null; i++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Renames a tag. "conflict" when another tag of the user already has that name (any case). */
export async function renameTag(
  database: typeof dbClient,
  userId: string,
  tagId: string,
  name: string,
): Promise<{ ok: true; tag: TagRef } | { ok: false; code: "notFound" | "conflict" }> {
  try {
    return await database.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
        .limit(1);
      if (!current) return { ok: false as const, code: "notFound" as const };
      const clash = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.userId, userId), sql`lower(${tags.name}) = ${name.toLowerCase()}`, sql`${tags.id} <> ${tagId}`))
        .limit(1);
      if (clash.length > 0) return { ok: false as const, code: "conflict" as const };
      await tx.update(tags).set({ name }).where(and(eq(tags.id, tagId), eq(tags.userId, userId)));
      return { ok: true as const, tag: { id: tagId, name } };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, code: "conflict" };
    throw error;
  }
}

/** What Undo needs to bring a deleted tag back. */
export interface TagSnapshot {
  tag: TagRef;
  /** The transactions it was on. */
  transactionIds: string[];
}

/**
 * Deletes a tag and, by cascade, its links; transactions are untouched. Returns what Undo
 * needs, or null when the tag isn't the user's.
 */
export async function deleteTag(database: typeof dbClient, userId: string, tagId: string): Promise<TagSnapshot | null> {
  return database.transaction(async (tx) => {
    const links = await tx
      .select({ transactionId: transactionTags.transactionId })
      .from(transactionTags)
      .where(and(eq(transactionTags.tagId, tagId), eq(transactionTags.userId, userId)));
    const [deleted] = await tx
      .delete(tags)
      .where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
      .returning({ id: tags.id, name: tags.name });
    if (!deleted) return null;
    return { tag: deleted, transactionIds: links.map((l) => l.transactionId) };
  });
}

/**
 * Undo of `deleteTag`: re-creates the tag with its old id and name and re-links only the
 * transactions that still exist, are the user's and have room for another tag. "conflict" when
 * a tag with that name (any case) or that id exists again.
 */
export async function restoreTag(
  database: typeof dbClient,
  userId: string,
  snapshot: TagSnapshot,
): Promise<{ ok: true; linked: number } | { ok: false; code: "conflict" | "tooManyUserTags" }> {
  try {
    return await database.transaction(async (tx) => {
      const clash = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(
          and(
            eq(tags.userId, userId),
            or(sql`lower(${tags.name}) = ${snapshot.tag.name.toLowerCase()}`, eq(tags.id, snapshot.tag.id)),
          ),
        )
        .limit(1);
      if (clash.length > 0) return { ok: false as const, code: "conflict" as const };
      const [total] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(tags)
        .where(eq(tags.userId, userId));
      if ((total?.value ?? 0) >= MAX_TAGS_PER_USER) return { ok: false as const, code: "tooManyUserTags" as const };

      await tx.insert(tags).values({ id: snapshot.tag.id, userId, name: snapshot.tag.name });

      let linked = 0;
      const ids = [...new Set(snapshot.transactionIds)];
      for (let i = 0; i < ids.length; i += 1000) {
        const slice = ids.slice(i, i + 1000);
        const owned = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.userId, userId), inArray(transactions.id, slice)));
        if (owned.length === 0) continue;
        const counts = await tx
          .select({ transactionId: transactionTags.transactionId, total: sql<number>`count(*)::int` })
          .from(transactionTags)
          .where(
            and(
              eq(transactionTags.userId, userId),
              inArray(
                transactionTags.transactionId,
                owned.map((o) => o.id),
              ),
            ),
          )
          .groupBy(transactionTags.transactionId);
        const have = new Map(counts.map((c) => [c.transactionId, c.total]));
        const room = owned.filter((o) => (have.get(o.id) ?? 0) < MAX_TAGS_PER_TRANSACTION);
        if (room.length === 0) continue;
        await tx
          .insert(transactionTags)
          .values(room.map((o) => ({ transactionId: o.id, tagId: snapshot.tag.id, userId })));
        linked += room.length;
      }
      return { ok: true as const, linked };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, code: "conflict" };
    throw error;
  }
}

/**
 * Adds tags (by name, created when new, reused case-insensitively) to one transaction and
 * returns all its tags sorted by name. Refused past the per-transaction cap, before anything
 * is created.
 */
export async function addTagsToTransaction(
  database: typeof dbClient,
  userId: string,
  transactionId: string,
  names: string[],
): Promise<{ ok: true; tags: TagRef[] } | { ok: false; code: TagWriteCode }> {
  return database.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
      .limit(1);
    if (!owned) return { ok: false as const, code: "notFound" as const };

    const current = (await loadTransactionTags(tx, userId, [transactionId])).get(transactionId) ?? [];
    const have = new Set(current.map((t) => t.name.toLowerCase()));
    const fresh = lowerNames(names).filter((n) => !have.has(n));
    if (current.length + fresh.length > MAX_TAGS_PER_TRANSACTION) {
      return { ok: false as const, code: "tooManyTags" as const };
    }

    const resolved = await getOrCreateTags(tx, userId, names);
    if (!resolved.ok) return resolved;
    if (resolved.tags.length > 0) {
      await tx
        .insert(transactionTags)
        .values(resolved.tags.map((t) => ({ transactionId, tagId: t.id, userId })))
        .onConflictDoNothing();
    }
    const all = (await loadTransactionTags(tx, userId, [transactionId])).get(transactionId) ?? [];
    return { ok: true as const, tags: all };
  });
}

/** Removes one tag from one transaction; false when there was no such link. */
export async function removeTagFromTransaction(
  database: typeof dbClient,
  userId: string,
  transactionId: string,
  tagId: string,
): Promise<boolean> {
  const removed = await database
    .delete(transactionTags)
    .where(
      and(
        eq(transactionTags.userId, userId),
        eq(transactionTags.transactionId, transactionId),
        eq(transactionTags.tagId, tagId),
      ),
    )
    .returning({ id: transactionTags.tagId });
  return removed.length > 0;
}

export const MAX_BULK_TAG_IDS = 500;

/**
 * Adds one tag (created or reused by name) to many transactions in one DB transaction.
 * `updated` counts links actually created; rows already carrying the tag are no-ops and
 * `skipped` counts rows already at the per-transaction cap. Ids that aren't the user's are
 * ignored. Refused when more than 500 ids are passed.
 */
export async function bulkAddTag(
  database: typeof dbClient,
  userId: string,
  transactionIds: string[],
  name: string,
): Promise<
  | { ok: true; updated: number; skipped: number; tag: TagRef | null }
  | { ok: false; code: "tooManyUserTags" | "tooManyRows" }
> {
  const ids = [...new Set(transactionIds)];
  if (ids.length > MAX_BULK_TAG_IDS) return { ok: false, code: "tooManyRows" };
  if (ids.length === 0) return { ok: true, updated: 0, skipped: 0, tag: null };

  return database.transaction(async (tx) => {
    const ownedRows = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids)));
    const owned = ownedRows.map((r) => r.id);
    if (owned.length === 0) return { ok: true as const, updated: 0, skipped: 0, tag: null };

    const resolved = await getOrCreateTags(tx, userId, [name]);
    if (!resolved.ok) return resolved;
    const tag = resolved.tags[0];
    if (!tag) return { ok: true as const, updated: 0, skipped: 0, tag: null };

    const counts = await tx
      .select({
        transactionId: transactionTags.transactionId,
        total: sql<number>`count(*)::int`,
        hasTag: sql<boolean>`bool_or(${transactionTags.tagId} = ${tag.id})`,
      })
      .from(transactionTags)
      .where(and(eq(transactionTags.userId, userId), inArray(transactionTags.transactionId, owned)))
      .groupBy(transactionTags.transactionId);
    const info = new Map(counts.map((c) => [c.transactionId, c]));

    const toInsert: string[] = [];
    let skipped = 0;
    for (const id of owned) {
      const c = info.get(id);
      if (c?.hasTag) continue;
      if ((c?.total ?? 0) >= MAX_TAGS_PER_TRANSACTION) skipped += 1;
      else toInsert.push(id);
    }
    if (toInsert.length > 0) {
      await tx
        .insert(transactionTags)
        .values(toInsert.map((transactionId) => ({ transactionId, tagId: tag.id, userId })))
        .onConflictDoNothing();
    }
    return { ok: true as const, updated: toInsert.length, skipped, tag };
  });
}

/** Removes a tag from many transactions; `updated` counts links actually removed. */
export async function bulkRemoveTag(
  database: typeof dbClient,
  userId: string,
  transactionIds: string[],
  tagId: string,
): Promise<{ updated: number }> {
  const ids = [...new Set(transactionIds)].slice(0, MAX_BULK_TAG_IDS);
  if (ids.length === 0) return { updated: 0 };
  return database.transaction(async (tx) => {
    const removed = await tx
      .delete(transactionTags)
      .where(
        and(
          eq(transactionTags.userId, userId),
          eq(transactionTags.tagId, tagId),
          inArray(transactionTags.transactionId, ids),
        ),
      )
      .returning({ id: transactionTags.transactionId });
    return { updated: removed.length };
  });
}

/** Sets (or clears, with null) a transaction's note; false when it isn't the user's. `note` is already normalized. */
export async function setTransactionNote(
  database: typeof dbClient,
  userId: string,
  transactionId: string,
  note: string | null,
): Promise<boolean> {
  const updated = await database
    .update(transactions)
    .set({ note })
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
    .returning({ id: transactions.id });
  return updated.length > 0;
}
