import { and, asc, eq, gte, inArray, isNull, max, or, sql } from "drizzle-orm";

import type { db as dbClient } from "../client";
import { categorizeLabel, compileRules, type CompiledRule, type RuleInput } from "../../lib/categorize/rules";
import type { RuleInputData } from "../../lib/categorize/schemas";
import { categories, categoryRules, merchants, transactions, type CategoryRule } from "../schema";
import { notSplit } from "./split-sql";

const CHUNK_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Anything that can run a select: the db client or a transaction handle. */
type Selectable = Pick<typeof dbClient, "select">;

export interface RuleWithCategory extends CategoryRule {
  categoryName: string;
  categoryColor: string;
  /** A top-level category's own icon; null for a subcategory. */
  categoryIcon: string | null;
}

/** The user's rules in evaluation order (priority asc, createdAt asc). */
export async function listRules(database: typeof dbClient, userId: string): Promise<RuleWithCategory[]> {
  const rows = await database
    .select({
      rule: categoryRules,
      categoryName: categories.name,
      categoryColor: categories.color,
      categoryIcon: categories.icon,
    })
    .from(categoryRules)
    .innerJoin(categories, and(eq(categories.id, categoryRules.categoryId), eq(categories.userId, userId)))
    .where(eq(categoryRules.userId, userId))
    .orderBy(asc(categoryRules.priority), asc(categoryRules.createdAt), asc(categoryRules.id));
  return rows.map((r) => ({
    ...r.rule,
    categoryName: r.categoryName,
    categoryColor: r.categoryColor,
    categoryIcon: r.categoryIcon,
  }));
}

/** Loads and compiles the user's rules once; usable inside a transaction. */
export async function loadCompiledRules(database: Selectable, userId: string): Promise<CompiledRule[]> {
  const rules: RuleInput[] = await database
    .select({
      id: categoryRules.id,
      categoryId: categoryRules.categoryId,
      matchType: categoryRules.matchType,
      pattern: categoryRules.pattern,
      priority: categoryRules.priority,
      createdAt: categoryRules.createdAt,
    })
    .from(categoryRules)
    .where(eq(categoryRules.userId, userId));
  return compileRules(rules);
}

async function categoryIsOwned(database: Selectable, userId: string, categoryId: string): Promise<boolean> {
  const [row] = await database
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);
  return row !== undefined;
}

/** Appends the rule after all existing ones. Null when the category isn't the user's. */
export async function createRule(
  database: typeof dbClient,
  userId: string,
  input: RuleInputData,
): Promise<CategoryRule | null> {
  return database.transaction(async (tx) => {
    if (!(await categoryIsOwned(tx, userId, input.categoryId))) return null;
    const [{ top }] = await tx
      .select({ top: max(categoryRules.priority) })
      .from(categoryRules)
      .where(eq(categoryRules.userId, userId));
    const [rule] = await tx
      .insert(categoryRules)
      .values({
        userId,
        categoryId: input.categoryId,
        matchType: input.matchType,
        pattern: input.pattern,
        priority: (top ?? -1) + 1,
      })
      .returning();
    return rule;
  });
}

/** Keeps the rule's priority. Null when the rule or the category isn't the user's. */
export async function updateRule(
  database: typeof dbClient,
  userId: string,
  ruleId: string,
  input: RuleInputData,
): Promise<CategoryRule | null> {
  return database.transaction(async (tx) => {
    if (!(await categoryIsOwned(tx, userId, input.categoryId))) return null;
    const [rule] = await tx
      .update(categoryRules)
      .set({
        categoryId: input.categoryId,
        matchType: input.matchType,
        pattern: input.pattern,
      })
      .where(and(eq(categoryRules.id, ruleId), eq(categoryRules.userId, userId)))
      .returning();
    return rule ?? null;
  });
}

/** What Undo needs to bring a deleted rule back. */
export interface RuleSnapshot {
  id: string;
  categoryId: string;
  matchType: CategoryRule["matchType"];
  pattern: string;
  priority: number;
}

/**
 * Deletes a rule and returns its snapshot, or null when it isn't the user's. Transactions it
 * categorized keep their category.
 */
export async function deleteRule(
  database: typeof dbClient,
  userId: string,
  ruleId: string,
): Promise<RuleSnapshot | null> {
  const [deleted] = await database
    .delete(categoryRules)
    .where(and(eq(categoryRules.id, ruleId), eq(categoryRules.userId, userId)))
    .returning({
      id: categoryRules.id,
      categoryId: categoryRules.categoryId,
      matchType: categoryRules.matchType,
      pattern: categoryRules.pattern,
      priority: categoryRules.priority,
    });
  return deleted ?? null;
}

/**
 * Undo of `deleteRule`: re-inserts the rule with its old id at its old priority, moving the
 * rules at or after it one place down. "not_found" when the category is no longer the user's,
 * "conflict" when the id exists again.
 */
export async function restoreRule(
  database: typeof dbClient,
  userId: string,
  snapshot: RuleSnapshot,
): Promise<{ ok: true; rule: CategoryRule } | { ok: false; error: "not_found" | "conflict" }> {
  return database.transaction(async (tx) => {
    if (!(await categoryIsOwned(tx, userId, snapshot.categoryId))) return { ok: false as const, error: "not_found" as const };
    const [existing] = await tx
      .select({ id: categoryRules.id })
      .from(categoryRules)
      .where(eq(categoryRules.id, snapshot.id))
      .limit(1);
    if (existing) return { ok: false as const, error: "conflict" as const };
    await tx
      .update(categoryRules)
      .set({ priority: sql`${categoryRules.priority} + 1` })
      .where(and(eq(categoryRules.userId, userId), gte(categoryRules.priority, snapshot.priority)));
    const [rule] = await tx
      .insert(categoryRules)
      .values({
        id: snapshot.id,
        userId,
        categoryId: snapshot.categoryId,
        matchType: snapshot.matchType,
        pattern: snapshot.pattern,
        priority: snapshot.priority,
      })
      .returning();
    return { ok: true as const, rule };
  });
}

/**
 * Rewrites priorities 0..n-1 following `orderedIds`, which must be exactly the
 * user's full set of rule ids. Returns false (and changes nothing) otherwise.
 */
export async function reorderRules(
  database: typeof dbClient,
  userId: string,
  orderedIds: string[],
): Promise<boolean> {
  return database.transaction(async (tx) => {
    const existing = await tx
      .select({ id: categoryRules.id })
      .from(categoryRules)
      .where(eq(categoryRules.userId, userId));
    const wanted = new Set(orderedIds);
    if (
      wanted.size !== orderedIds.length ||
      wanted.size !== existing.length ||
      existing.some((r) => !wanted.has(r.id))
    ) {
      return false;
    }
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(categoryRules)
        .set({ priority: index })
        .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)));
    }
    return true;
  });
}

export interface ApplyRulesResult {
  updated: number;
  /** category id -> ids of the transactions just categorized into it. */
  byCategory: Record<string, string[]>;
}

/** Rows rules may fill: uncategorized, or categorized by the bank's mapping or a guess (rules outrank both). */
const RULE_FILLABLE = or(
  isNull(transactions.categoryId),
  inArray(transactions.categorySource, ["bank", "guess"]),
);

/**
 * Categorizes the user's uncategorized transactions with the current rules,
 * and replaces categories that only came from the bank's mapping or a guess. Rows with a
 * manual or rule category are never touched, nor are split transactions (their own
 * category is ignored while split): the candidate query and every update carry the
 * same guards.
 */
export async function applyRulesToUncategorized(
  database: typeof dbClient,
  userId: string,
): Promise<ApplyRulesResult> {
  return database.transaction((tx) => applyRulesInTransaction(tx, userId));
}

/** Same as `applyRulesToUncategorized`, inside a transaction the caller already holds. */
export async function applyRulesInTransaction(
  tx: Pick<typeof dbClient, "select" | "update">,
  userId: string,
): Promise<ApplyRulesResult> {
  const rules = await loadCompiledRules(tx, userId);
  const result: ApplyRulesResult = { updated: 0, byCategory: {} };
  if (rules.length === 0) return result;

  const rows = await tx
    .select({
      id: transactions.id,
      labelNormalized: transactions.labelNormalized,
      labelDisplay: transactions.labelDisplay,
      merchantName: merchants.name,
    })
    .from(transactions)
    .leftJoin(merchants, and(eq(merchants.id, transactions.merchantId), eq(merchants.userId, userId)))
    .where(and(eq(transactions.userId, userId), RULE_FILLABLE, notSplit(userId)));

  const matched = new Map<string, string[]>();
  for (const row of rows) {
    const categoryId = categorizeLabel(rules, {
      normalized: row.labelNormalized,
      display: row.labelDisplay,
      merchant: row.merchantName,
    });
    if (categoryId === null) continue;
    const ids = matched.get(categoryId) ?? [];
    ids.push(row.id);
    matched.set(categoryId, ids);
  }

  for (const [categoryId, ids] of matched) {
    for (const part of chunk(ids, CHUNK_SIZE)) {
      const done = await tx
        .update(transactions)
        .set({ categoryId, categorySource: "rule" })
        .where(
          and(
            eq(transactions.userId, userId),
            inArray(transactions.id, part),
            RULE_FILLABLE,
            notSplit(userId),
          ),
        )
        .returning({ id: transactions.id });
      if (done.length === 0) continue;
      (result.byCategory[categoryId] ??= []).push(...done.map((d) => d.id));
      result.updated += done.length;
    }
  }
  return result;
}

/**
 * Undo for "Create rule": deletes the rule and clears the category of the given rows, but only
 * those still categorized by that rule's category with source 'rule', so anything changed by
 * hand since is left alone. One DB transaction. Returns null when the rule isn't the user's.
 */
export async function undoRule(
  database: typeof dbClient,
  userId: string,
  ruleId: string,
  transactionIds: string[],
): Promise<{ cleared: string[] } | null> {
  return database.transaction(async (tx) => {
    const [rule] = await tx
      .select({ categoryId: categoryRules.categoryId })
      .from(categoryRules)
      .where(and(eq(categoryRules.id, ruleId), eq(categoryRules.userId, userId)))
      .limit(1);
    if (!rule) return null;
    await tx.delete(categoryRules).where(and(eq(categoryRules.id, ruleId), eq(categoryRules.userId, userId)));

    const cleared: string[] = [];
    for (const part of chunk(transactionIds, CHUNK_SIZE)) {
      const done = await tx
        .update(transactions)
        .set({ categoryId: null, categorySource: null })
        .where(
          and(
            eq(transactions.userId, userId),
            inArray(transactions.id, part),
            eq(transactions.categorySource, "rule"),
            eq(transactions.categoryId, rule.categoryId),
          ),
        )
        .returning({ id: transactions.id });
      cleared.push(...done.map((d) => d.id));
    }
    return { cleared };
  });
}
