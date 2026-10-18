import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db, type db as dbClient } from "../client";
import {
  bankCategoryMappings,
  categories,
  categoryBudgets,
  categoryRules,
  transactions,
  transactionSplits,
  type Category,
} from "../schema";
import { getMonthlyCategorySpending } from "./budgets";
import { rollUpMonthlySpending } from "../../lib/budgets/rollover";
import { monthRange } from "../../lib/dashboard/month";
import { notSplit } from "./split-sql";
import {
  orderedCategoryOptions,
  validateParent,
  type CategoryOption,
  type HierarchyCode,
} from "../../lib/categorize/hierarchy";
import type { CategoryInput } from "../../lib/categorize/schemas";

// Every query here must be scoped by userId — categories are per-user data.
export async function listCategories(userId: string): Promise<Category[]> {
  return db.select().from(categories).where(eq(categories.userId, userId)).orderBy(asc(categories.name));
}

/** Picker options in tree order with "Parent > Child" labels. */
export async function listCategoryOptions(userId: string, locale: string): Promise<CategoryOption[]> {
  return orderedCategoryOptions(await listCategories(userId), locale);
}

/** Ownership check for server actions: filters on both id and userId. */
export async function getOwnedCategory(
  database: Pick<typeof dbClient, "select">,
  userId: string,
  categoryId: string,
): Promise<Category | null> {
  const [category] = await database
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);
  return category ?? null;
}

export type CategoryWriteError = "name_taken" | "not_found" | HierarchyCode;
export type CategoryWriteResult = { ok: true; category: Category } | { ok: false; error: CategoryWriteError };

// Drizzle wraps driver errors, so the Postgres code may sit on `cause`.
function isNameTaken(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && typeof e === "object" && depth < 3; depth += 1) {
    const { code, constraint, cause } = e as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (
      code === "23505" &&
      (constraint === undefined || constraint === "categories_user_id_parent_id_name_unique")
    ) {
      return true;
    }
    e = cause;
  }
  return false;
}

type Executor = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];

/**
 * Locks the rows involved in a hierarchy change (the category being edited and
 * the chosen parent) so two concurrent moves can't create a cycle or a third
 * level, then validates against the user's current categories.
 */
async function validateParentLocked(
  tx: Executor,
  userId: string,
  categoryId: string | null,
  parentId: string | null,
): Promise<HierarchyCode | null> {
  const lockIds = [categoryId, parentId].filter((id): id is string => id !== null);
  if (lockIds.length > 0) {
    await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.userId, userId), inArray(categories.id, lockIds)))
      .orderBy(asc(categories.id))
      .for("update");
  }
  const all = await tx.select().from(categories).where(eq(categories.userId, userId));
  const result = validateParent(all, categoryId, parentId);
  return result.ok ? null : result.code;
}

export async function createCategory(
  database: typeof dbClient,
  userId: string,
  input: CategoryInput,
): Promise<CategoryWriteResult> {
  const parentId = input.parentId ?? null;
  try {
    return await database.transaction(async (tx): Promise<CategoryWriteResult> => {
      const code = await validateParentLocked(tx, userId, null, parentId);
      if (code) return { ok: false, error: code };
      const [category] = await tx
        .insert(categories)
        .values({ userId, name: input.name, color: input.color, parentId, icon: input.icon ?? null })
        .returning();
      return { ok: true, category };
    });
  } catch (error) {
    if (isNameTaken(error)) return { ok: false, error: "name_taken" };
    throw error;
  }
}

/**
 * Rename, recolor, re-icon and/or move. `input.parentId` undefined leaves the parent
 * unchanged, null makes it top-level. Transactions and rules follow the
 * category because they reference its id.
 */
export async function updateCategory(
  database: typeof dbClient,
  userId: string,
  categoryId: string,
  input: CategoryInput,
): Promise<CategoryWriteResult> {
  try {
    return await database.transaction(async (tx): Promise<CategoryWriteResult> => {
      const [current] = await tx
        .select({ parentId: categories.parentId })
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
        .limit(1);
      if (!current) return { ok: false, error: "not_found" };

      const moving = input.parentId !== undefined && input.parentId !== current.parentId;
      if (moving) {
        const code = await validateParentLocked(tx, userId, categoryId, input.parentId ?? null);
        if (code) return { ok: false, error: code };
      }
      const [category] = await tx
        .update(categories)
        .set({
          name: input.name,
          color: input.color,
          // undefined = unchanged, null = cleared.
          ...(input.icon !== undefined ? { icon: input.icon } : {}),
          ...(moving ? { parentId: input.parentId ?? null } : {}),
        })
        .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
        .returning();
      return category ? { ok: true, category } : { ok: false, error: "not_found" };
    });
  } catch (error) {
    if (isNameTaken(error)) return { ok: false, error: "name_taken" };
    throw error;
  }
}

/**
 * Distinct transactions filed on any of the categories: an unsplit one by its own category,
 * a split one through a part (its own category is ignored while split), so a split with
 * two parts in the same category still counts once. Scoped by user_id.
 */
async function countTransactionsInCategories(
  database: Pick<typeof dbClient, "select">,
  userId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const [row] = await database
    .select({ value: count() })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        or(
          and(notSplit(userId), inArray(transactions.categoryId, ids)),
          sql`EXISTS (SELECT 1 FROM "transaction_splits" sp WHERE sp."user_id" = ${userId} AND sp."transaction_id" = "transactions"."id" AND sp."category_id" IN (${idList}))`,
        ),
      ),
    );
  return row.value;
}

export interface CategoryUsage {
  /** Transactions filed directly on this category, including split ones with a part in it. */
  transactions: number;
  /** Rules targeting this category directly. */
  rules: number;
  /** Direct children (0 for a subcategory). */
  subcategories: number;
  /** Transactions and rules filed on those children. */
  subcategoryTransactions: number;
  subcategoryRules: number;
  parent: { id: string; name: string } | null;
  /** The category has a monthly budget (it goes with the category). */
  budget: boolean;
  /** Bank-category mappings pointing at it (they go with the category). */
  bankMappings: number;
}

/** True when deleting the category loses nothing the user could want back (so Undo is enough). */
export function isCategoryUnused(usage: CategoryUsage): boolean {
  return (
    usage.transactions === 0 &&
    usage.rules === 0 &&
    usage.subcategories === 0 &&
    !usage.budget &&
    usage.bankMappings === 0
  );
}

/** What deleting the category would affect; null when it isn't the user's. */
export async function getCategoryUsage(
  database: Pick<typeof dbClient, "select">,
  userId: string,
  categoryId: string,
): Promise<CategoryUsage | null> {
  const category = await getOwnedCategory(database, userId, categoryId);
  if (!category) return null;

  const children = await database
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.parentId, categoryId)));
  const childIds = children.map((c) => c.id);

  const countTransactions = (ids: string[]) => countTransactionsInCategories(database, userId, ids);
  const countRules = async (ids: string[]) => {
    if (ids.length === 0) return 0;
    const [row] = await database
      .select({ value: count() })
      .from(categoryRules)
      .where(and(eq(categoryRules.userId, userId), inArray(categoryRules.categoryId, ids)));
    return row.value;
  };

  let parent: CategoryUsage["parent"] = null;
  if (category.parentId) {
    const found = await getOwnedCategory(database, userId, category.parentId);
    if (found) parent = { id: found.id, name: found.name };
  }

  const [budget] = await database
    .select({ id: categoryBudgets.categoryId })
    .from(categoryBudgets)
    .where(and(eq(categoryBudgets.userId, userId), eq(categoryBudgets.categoryId, categoryId)))
    .limit(1);
  const [mappings] = await database
    .select({ value: count() })
    .from(bankCategoryMappings)
    .where(and(eq(bankCategoryMappings.userId, userId), eq(bankCategoryMappings.categoryId, categoryId)));

  return {
    budget: budget !== undefined,
    bankMappings: mappings.value,
    transactions: await countTransactions([categoryId]),
    rules: await countRules([categoryId]),
    subcategories: childIds.length,
    subcategoryTransactions: await countTransactions(childIds),
    subcategoryRules: await countRules(childIds),
    parent,
  };
}

/**
 * - `uncategorize`: the category's transactions lose their category (and source),
 *   its rules are deleted. Also the behavior for a top-level category without
 *   subcategories, whatever the option.
 * - `move_to_parent`: subcategory only; transactions (source kept) and rules move
 *   to the parent. On a category that has no parent it behaves as `uncategorize`.
 * - `keep_subcategories`: parent only; children become top-level, then the
 *   parent's own transactions/rules are dropped as in `uncategorize`.
 * - `delete_subcategories`: parent only; children and parent are all deleted
 *   with their transactions uncategorized and rules deleted.
 * Split parts follow their transactions: `move_to_parent` moves parts to the parent, every
 * other path sets the parts' category to null. Summary counts are distinct transactions
 * (a split counts once, by its parts; its own ignored category does not count).
 * On a parent with subcategories, `uncategorize` and `move_to_parent` behave
 * like `keep_subcategories` (the non-destructive choice); on a subcategory,
 * the two parent-only options behave like `uncategorize`.
 * Omitted: `move_to_parent` for a subcategory, otherwise `keep_subcategories`.
 */
export type DeleteCategoryOption =
  | "uncategorize"
  | "move_to_parent"
  | "keep_subcategories"
  | "delete_subcategories";

export interface DeleteCategorySummary {
  transactionsUncategorized: number;
  transactionsMoved: number;
  rulesDeleted: number;
  rulesMoved: number;
  subcategoriesDeleted: number;
  subcategoriesPromoted: number;
}

export type DeleteCategoryResult =
  | ({ ok: true } & DeleteCategorySummary)
  // subcategory_name_taken: promoting a child would collide with an existing
  // top-level name; nothing is changed.
  | { ok: false; error: "not_found" | "subcategory_name_taken" };

/** Deletes in one DB transaction (see DeleteCategoryOption). */
export async function deleteCategory(
  database: typeof dbClient,
  userId: string,
  categoryId: string,
  option?: DeleteCategoryOption,
): Promise<DeleteCategoryResult> {
  return database.transaction(async (tx): Promise<DeleteCategoryResult> => {
    const owned = await tx
      .select()
      .from(categories)
      .where(and(eq(categories.userId, userId), or(eq(categories.id, categoryId), eq(categories.parentId, categoryId))))
      .for("update");
    const target = owned.find((c) => c.id === categoryId);
    if (!target) return { ok: false, error: "not_found" };
    const children = owned.filter((c) => c.parentId === categoryId);

    const summary: DeleteCategorySummary = {
      transactionsUncategorized: 0,
      transactionsMoved: 0,
      rulesDeleted: 0,
      rulesMoved: 0,
      subcategoriesDeleted: 0,
      subcategoriesPromoted: 0,
    };

    // Uncategorize transactions and delete rules for the given categories.
    // Explicit deletes (rather than the cascade) so we can count them.
    // Parts follow the rows: their category is nulled (the split then shows under
    // Uncategorized until fixed in the editor). Counts are distinct transactions, so a
    // split counts once, and are taken before the updates.
    const drop = async (ids: string[]) => {
      const affected = await countTransactionsInCategories(tx, userId, ids);
      await tx
        .update(transactionSplits)
        .set({ categoryId: null })
        .where(and(eq(transactionSplits.userId, userId), inArray(transactionSplits.categoryId, ids)));
      await tx
        .update(transactions)
        .set({ categoryId: null, categorySource: null })
        .where(and(eq(transactions.userId, userId), inArray(transactions.categoryId, ids)));
      const rules = await tx
        .delete(categoryRules)
        .where(and(eq(categoryRules.userId, userId), inArray(categoryRules.categoryId, ids)))
        .returning({ id: categoryRules.id });
      summary.transactionsUncategorized += affected;
      summary.rulesDeleted += rules.length;
    };

    if (children.length > 0) {
      const childIds = children.map((c) => c.id);
      if (option === "delete_subcategories") {
        await drop([...childIds, categoryId]);
        await tx.delete(categories).where(and(eq(categories.userId, userId), inArray(categories.id, childIds)));
        summary.subcategoriesDeleted = childIds.length;
      } else {
        const topLevel = await tx
          .select({ name: categories.name })
          .from(categories)
          .where(and(eq(categories.userId, userId), isNull(categories.parentId)));
        const taken = new Set(topLevel.map((c) => c.name));
        if (children.some((c) => taken.has(c.name))) return { ok: false, error: "subcategory_name_taken" };
        await tx
          .update(categories)
          .set({ parentId: null })
          .where(and(eq(categories.userId, userId), inArray(categories.id, childIds)));
        summary.subcategoriesPromoted = childIds.length;
        await drop([categoryId]);
      }
    } else if (target.parentId && (option === undefined || option === "move_to_parent")) {
      const affected = await countTransactionsInCategories(tx, userId, [categoryId]);
      await tx
        .update(transactionSplits)
        .set({ categoryId: target.parentId })
        .where(and(eq(transactionSplits.userId, userId), eq(transactionSplits.categoryId, categoryId)));
      await tx
        .update(transactions)
        .set({ categoryId: target.parentId })
        .where(and(eq(transactions.userId, userId), eq(transactions.categoryId, categoryId)));
      const rules = await tx
        .update(categoryRules)
        .set({ categoryId: target.parentId })
        .where(and(eq(categoryRules.userId, userId), eq(categoryRules.categoryId, categoryId)))
        .returning({ id: categoryRules.id });
      summary.transactionsMoved = affected;
      summary.rulesMoved = rules.length;
    } else {
      await drop([categoryId]);
    }

    await tx.delete(categories).where(and(eq(categories.id, categoryId), eq(categories.userId, userId)));
    return { ok: true, ...summary };
  });
}

/** What Undo needs to bring a deleted category back. */
export interface CategorySnapshot {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  parentId: string | null;
}

export type DeleteUnusedResult =
  | { status: "deleted"; snapshot: CategorySnapshot }
  | { status: "in_use"; usage: CategoryUsage }
  | { status: "not_found" };

/**
 * Deletes the category only when nothing depends on it. The row is locked first, so a
 * transaction or rule filed on it at the same moment waits and is then seen by the check.
 * Otherwise nothing changes and the usage comes back for the choices sheet.
 */
export async function deleteCategoryIfUnused(
  database: typeof dbClient,
  userId: string,
  categoryId: string,
): Promise<DeleteUnusedResult> {
  return database.transaction(async (tx): Promise<DeleteUnusedResult> => {
    const [category] = await tx
      .select()
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .for("update");
    if (!category) return { status: "not_found" };
    const usage = await getCategoryUsage(tx, userId, categoryId);
    if (!usage) return { status: "not_found" };
    if (!isCategoryUnused(usage)) return { status: "in_use", usage };
    await tx.delete(categories).where(and(eq(categories.id, categoryId), eq(categories.userId, userId)));
    return {
      status: "deleted",
      snapshot: {
        id: category.id,
        name: category.name,
        color: category.color,
        icon: category.icon,
        parentId: category.parentId,
      },
    };
  });
}

export type RestoreCategoryResult =
  | { ok: true; category: Category }
  | { ok: false; error: "name_taken" | "parent_not_found" | "conflict" };

/**
 * Undo of `deleteCategoryIfUnused`: re-creates the category with its old id. Refused when the
 * name has been taken since, the parent is gone (or is no longer top-level), or the id is in use.
 * Everything the snapshot says comes from the client, so it is validated by the caller and the
 * parent is re-checked here against the user's own rows.
 */
export async function restoreCategory(
  database: typeof dbClient,
  userId: string,
  snapshot: CategorySnapshot,
): Promise<RestoreCategoryResult> {
  try {
    return await database.transaction(async (tx): Promise<RestoreCategoryResult> => {
      const [existing] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, snapshot.id))
        .limit(1);
      if (existing) return { ok: false, error: "conflict" };
      if (snapshot.parentId) {
        const [parent] = await tx
          .select({ id: categories.id, parentId: categories.parentId })
          .from(categories)
          .where(and(eq(categories.id, snapshot.parentId), eq(categories.userId, userId)))
          .for("update");
        if (!parent || parent.parentId !== null) return { ok: false, error: "parent_not_found" };
      }
      const [category] = await tx
        .insert(categories)
        .values({
          id: snapshot.id,
          userId,
          name: snapshot.name,
          color: snapshot.color,
          icon: snapshot.icon,
          parentId: snapshot.parentId,
        })
        .returning();
      return { ok: true, category };
    });
  } catch (error) {
    if (isNameTaken(error)) return { ok: false, error: "name_taken" };
    throw error;
  }
}

/**
 * This month's spending per category (outflows as positive cents), rolled up so a parent
 * includes its subcategories. Categories without spending are absent.
 */
export async function getCategoryMonthSpending(
  database: typeof dbClient,
  userId: string,
  month: string,
): Promise<Record<string, number>> {
  const [rows, all] = await Promise.all([
    getMonthlyCategorySpending(database, userId, monthRange(month)),
    database
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.userId, userId)),
  ]);
  const rolled = rollUpMonthlySpending(rows, new Map(all.map((c) => [c.id, c.parentId])));
  const result: Record<string, number> = {};
  for (const [categoryId, months] of rolled) {
    const cents = months.get(month);
    if (cents) result[categoryId] = cents;
  }
  return result;
}
