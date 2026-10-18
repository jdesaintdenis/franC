import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { db as dbClient } from "../client";
import {
  buildMappingLookup,
  resolveBankCategory,
  type BankCategoryOption,
  type BankCategoryWrites,
  type BankMapping,
  type BankMappingLookup,
} from "../../lib/categorize/bank";
import { bankCategoryMappings, categories, transactions, type BankCategoryMapping } from "../schema";
import { notSplit } from "./split-sql";

/** The db client or a transaction handle. */
type Database = Pick<typeof dbClient, "select" | "selectDistinct" | "insert" | "update" | "delete">;

export type BankMappingErrorCode = "category_not_found";

export interface BankMappingWithCategory {
  id: string;
  bankCategory: string;
  bankSubcategory: string | null;
  /** Null = Ignored. */
  categoryId: string | null;
  categoryName: string | null;
  /** Name of the category's parent when it is a subcategory. */
  categoryParentName: string | null;
  categoryColor: string | null;
}

/** The user's mappings with the target category's name and parent, by bank category then subcategory. */
export async function listBankMappings(
  database: Pick<typeof dbClient, "select">,
  userId: string,
): Promise<BankMappingWithCategory[]> {
  const parent = sql`(select p.name from categories p where p.id = ${categories.parentId} and p.user_id = ${userId})`;
  const rows = await database
    .select({
      id: bankCategoryMappings.id,
      bankCategory: bankCategoryMappings.bankCategory,
      bankSubcategory: bankCategoryMappings.bankSubcategory,
      categoryId: bankCategoryMappings.categoryId,
      categoryName: categories.name,
      categoryParentName: sql<string | null>`${parent}`,
      categoryColor: categories.color,
    })
    .from(bankCategoryMappings)
    .leftJoin(
      categories,
      and(eq(categories.id, bankCategoryMappings.categoryId), eq(categories.userId, userId)),
    )
    .where(eq(bankCategoryMappings.userId, userId))
    .orderBy(
      asc(bankCategoryMappings.bankCategory),
      sql`${bankCategoryMappings.bankSubcategory} nulls first`,
    );
  return rows;
}

/** What the import preview needs: stored mappings and the user's categories. */
export async function loadBankPlanContext(
  database: Pick<typeof dbClient, "select">,
  userId: string,
): Promise<{ mappings: BankMappingLookup; categories: BankCategoryOption[] }> {
  const [mappingRows, categoryRows] = await Promise.all([
    loadBankMappings(database, userId),
    database
      .select({ id: categories.id, name: categories.name, parentId: categories.parentId, color: categories.color })
      .from(categories)
      .where(eq(categories.userId, userId)),
  ]);
  return { mappings: buildMappingLookup(mappingRows), categories: categoryRows };
}

/** The user's stored mappings as plain records. */
export async function loadBankMappings(database: Pick<typeof dbClient, "select">, userId: string): Promise<BankMapping[]> {
  return database
    .select({
      bankCategory: bankCategoryMappings.bankCategory,
      bankSubcategory: bankCategoryMappings.bankSubcategory,
      categoryId: bankCategoryMappings.categoryId,
    })
    .from(bankCategoryMappings)
    .where(eq(bankCategoryMappings.userId, userId));
}

export interface BankMappingInput {
  bankCategory: string;
  bankSubcategory: string | null;
  /** Null = Ignored. */
  categoryId: string | null;
}

async function categoryIsOwned(database: Pick<typeof dbClient, "select">, userId: string, categoryId: string) {
  const [row] = await database
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);
  return row !== undefined;
}

/** Inserts or replaces one mapping. Fails when the target isn't the user's category. */
export async function upsertBankMapping(
  database: Database,
  userId: string,
  input: BankMappingInput,
): Promise<{ ok: true; mapping: BankCategoryMapping } | { ok: false; code: BankMappingErrorCode }> {
  if (input.categoryId !== null && !(await categoryIsOwned(database, userId, input.categoryId))) {
    return { ok: false, code: "category_not_found" };
  }
  const [mapping] = await database
    .insert(bankCategoryMappings)
    .values({ userId, ...input })
    .onConflictDoUpdate({
      target: [
        bankCategoryMappings.userId,
        bankCategoryMappings.bankCategory,
        bankCategoryMappings.bankSubcategory,
      ],
      set: { categoryId: input.categoryId },
    })
    .returning();
  return { ok: true, mapping };
}

/** Removes a mapping (asked again at the next import). Rows keep their category. True when deleted. */
export async function forgetBankMapping(
  database: Database,
  userId: string,
  mappingId: string,
): Promise<boolean> {
  const deleted = await database
    .delete(bankCategoryMappings)
    .where(and(eq(bankCategoryMappings.id, mappingId), eq(bankCategoryMappings.userId, userId)))
    .returning({ id: bankCategoryMappings.id });
  return deleted.length > 0;
}

/** Rows a bank mapping may fill: uncategorized, or only guessed (a mapping outranks a guess). */
const BANK_FILLABLE = or(isNull(transactions.categoryId), eq(transactions.categorySource, "guess"));

/**
 * Gives the user's uncategorized rows (and guessed ones) that carry a bank category the
 * category their mappings resolve to (source 'bank'). Rows with a manual or rule
 * category are never touched: the candidates and every update carry `BANK_FILLABLE`. Split transactions are skipped too: their own category is
 * ignored while split. Works per distinct (category, subcategory) pair, so
 * the number of statements follows the bank's taxonomy, not the row count.
 * Returns the number of rows updated.
 */
export async function applyBankMappings(
  database: Database,
  userId: string,
  opts: { bankCategory?: string } = {},
): Promise<number> {
  const lookup = buildMappingLookup(await loadBankMappings(database, userId));
  if (lookup.size === 0) return 0;

  const pairs = await database
    .selectDistinct({
      bankCategory: transactions.bankCategory,
      bankSubcategory: transactions.bankSubcategory,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        BANK_FILLABLE,
        notSplit(userId),
        opts.bankCategory === undefined
          ? isNotNull(transactions.bankCategory)
          : eq(transactions.bankCategory, opts.bankCategory),
      ),
    );

  let updated = 0;
  for (const pair of pairs) {
    const categoryId = resolveBankCategory(pair, lookup);
    if (categoryId === null || pair.bankCategory === null) continue;
    const done = await database
      .update(transactions)
      .set({ categoryId, categorySource: "bank" })
      .where(
        and(
          eq(transactions.userId, userId),
          BANK_FILLABLE,
          notSplit(userId),
          eq(transactions.bankCategory, pair.bankCategory),
          sql`${transactions.bankSubcategory} is not distinct from ${pair.bankSubcategory}::text`,
        ),
      )
      .returning({ id: transactions.id });
    updated += done.length;
  }
  return updated;
}

/**
 * After a mapping of `bankCategory` changed: drops the categories the bank
 * mappings gave to its rows, then applies the current mappings. Rule and
 * manual rows are untouched.
 */
export async function reapplyBankMapping(
  database: Database,
  userId: string,
  bankCategory: string,
): Promise<number> {
  await database
    .update(transactions)
    .set({ categoryId: null, categorySource: null })
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.bankCategory, bankCategory),
        eq(transactions.categorySource, "bank"),
        notSplit(userId),
      ),
    );
  return applyBankMappings(database, userId, { bankCategory });
}

/** Settings edit: stores the mapping and re-applies it, atomically. */
export async function updateBankMapping(
  database: typeof dbClient,
  userId: string,
  input: BankMappingInput,
): Promise<{ ok: true; rowsUpdated: number } | { ok: false; code: BankMappingErrorCode }> {
  return database.transaction(async (tx) => {
    const result = await upsertBankMapping(tx, userId, input);
    if (!result.ok) return result;
    return { ok: true as const, rowsUpdated: await reapplyBankMapping(tx, userId, input.bankCategory) };
  });
}

/**
 * Creates the categories (parents first) and stores the mappings from the
 * confirmed import decisions. A name taken meanwhile reuses the existing row.
 * Runs inside the import transaction; the composite FKs make the database
 * reject any category id that isn't the user's.
 */
export async function applyBankCategoryWrites(
  tx: Database,
  userId: string,
  writes: BankCategoryWrites,
): Promise<void> {
  const created = new Map<string, string>();
  for (const item of writes.create) {
    const parentId = item.parentId ?? (item.parentKey === null ? null : (created.get(item.parentKey) ?? null));
    const [row] = await tx
      .insert(categories)
      .values({ userId, name: item.name, color: item.color, icon: item.icon, parentId })
      .onConflictDoNothing()
      .returning({ id: categories.id });
    if (row) {
      created.set(item.createKey, row.id);
      continue;
    }
    const [existing] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.userId, userId),
          eq(categories.name, item.name),
          parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId),
        ),
      );
    if (!existing) throw new Error("Category could not be created");
    created.set(item.createKey, existing.id);
  }

  for (const mapping of writes.mappings) {
    let categoryId: string | null = null;
    if (mapping.target.kind === "category") categoryId = mapping.target.categoryId;
    else if (mapping.target.kind === "created") {
      categoryId = created.get(mapping.target.createKey) ?? null;
      if (categoryId === null) throw new Error("Mapping refers to a category that was not created");
    }
    await tx
      .insert(bankCategoryMappings)
      .values({ userId, bankCategory: mapping.bankCategory, bankSubcategory: mapping.bankSubcategory, categoryId })
      .onConflictDoUpdate({
        target: [
          bankCategoryMappings.userId,
          bankCategoryMappings.bankCategory,
          bankCategoryMappings.bankSubcategory,
        ],
        set: { categoryId },
      });
  }
}

/** One of the user's stored mappings by id, or null when it isn't theirs. */
export async function getOwnedBankMapping(
  database: Pick<typeof dbClient, "select">,
  userId: string,
  mappingId: string,
): Promise<BankCategoryMapping | null> {
  const [row] = await database
    .select()
    .from(bankCategoryMappings)
    .where(and(eq(bankCategoryMappings.id, mappingId), eq(bankCategoryMappings.userId, userId)))
    .limit(1);
  return row ?? null;
}
