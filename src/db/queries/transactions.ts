import { and, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as dbClient } from "../client";
import { normalizeLabel } from "../../lib/import/normalize-label";
import type { Cursor, TransactionFilters } from "../../lib/transactions/filters";
import { accounts, categories, imports, merchants, recurring, transactions, transactionSplits, transfers } from "../schema";
import { loadSplitParts, type SplitPart } from "./splits";
import { isSplit, notSplit } from "./split-sql";
import { inTransfer, notIgnored, notInTransfer } from "./transfer-sql";
import { getOwnedCategory } from "./categories";
import { loadTransactionTags, type TagRef } from "./tags";

export interface TransactionListItem {
  id: string;
  date: string;
  amountCents: number;
  /** What to show: the merchant name, else `label_display`, else the raw bank label. */
  label: string;
  /** The raw bank label (`label_raw`), for showing under the name when they differ. */
  bankLabel: string | null;
  /** The bank's short label (`label_display`, else the raw one): what "Rename merchant" starts from. */
  shortLabel: string;
  /** The merchant name the row carries, if any. */
  merchant: { id: string; name: string } | null;
  accountId: string;
  /** Name of the transaction's account (the user's own data, not translated). */
  accountName: string;
  category: { id: string; name: string; color: string; icon: string | null; parentName: string | null } | null;
  /** Null exactly when `category` is null. */
  categorySource: "manual" | "rule" | "bank" | "guess" | null;
  /** Set when the row is one leg of an internal transfer. */
  transfer: {
    id: string;
    status: "detected" | "confirmed";
    /** Name of the other leg's account (the user's own data, not translated). */
    counterpartAccountName: string;
    counterpartDate: string;
    counterpartAmountCents: number;
  } | null;
  /**
   * Set when the row is split: its parts by position. While split, `category` is the row's
   * own (ignored) category and the parts are what count.
   */
  split: { parts: SplitPart[] } | null;
  /** The user's own free-text note, if any. */
  note: string | null;
  /** Tags on the whole transaction, sorted by name. */
  tags: TagRef[];
  /** Whether the row has left the review queue (`reviewed_at` is set). */
  reviewed: boolean;
  /** Set aside by the user: left out of totals and hidden from the list by default. */
  ignored: boolean;
  /** The regular payment the row belongs to; `tracked` when the user tracks it (Slice 53). */
  recurring: { id: string; tracked: boolean } | null;
  /**
   * Where the row came from: a CSV import, a bank sync, franC itself or the user's hand (Slice 56), and when that
   * import (or run) happened. `importKind` is the kind of the holding import: "franc" with a source of "csv" or
   * "sync" is a row added by hand and later found in the bank. `awaitingBank`: added by hand, still waiting.
   */
  origin: {
    source: "csv" | "sync" | "franc" | "manual";
    importKind: "csv" | "sync" | "franc";
    awaitingBank: boolean;
    importedAt: Date;
  };
}

export const PAGE_SIZE = 50;

/** Escapes LIKE wildcards so user text always matches literally. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Subcategory ids of a category, scoped by user_id so a foreign category id matches nothing. */
function childCategoryIds(userId: string, categoryId: string): SQL {
  return sql`SELECT ${categories.id} FROM ${categories} WHERE ${categories.userId} = ${userId} AND ${categories.parentId} = ${categoryId}`;
}

/** Whether a split part's category column (`column`) matches the category filter (a parent covers its children). */
function partCategoryCondition(userId: string, category: string, column: SQL): SQL {
  if (category === "none") return sql`${column} IS NULL`;
  return sql`(${column} = ${category} OR ${column} IN (${childCategoryIds(userId, category)}))`;
}

/**
 * Every condition starts with the user_id scope. Filter values reach SQL only
 * as bound parameters.
 */
export function buildWhere(userId: string, filters: TransactionFilters, cursor: Cursor | null): SQL {
  const conditions: SQL[] = [eq(transactions.userId, userId)];

  // Search: accent-insensitive on both labels and the merchant name. The normalized label is already
  // accent-free; the display label (which may differ from the raw one) is
  // unaccented on both sides in SQL so "Vétérinaire" and "Veterinaire" match.
  const q = filters.q?.trim();
  if (q && normalizeLabel(q) !== "") {
    const normalized = `%${escapeLike(normalizeLabel(q))}%`;
    const display = `%${escapeLike(q)}%`;
    const search = or(
      sql`${transactions.labelNormalized} ILIKE ${normalized} ESCAPE '\\'`,
      sql`unaccent(${transactions.labelDisplay}) ILIKE unaccent(${display}) ESCAPE '\\'`,
      // Correlated on the explicit "transactions"."merchant_id" (see split-sql.ts) and scoped by user_id.
      sql`EXISTS (SELECT 1 FROM "merchants" m WHERE m."user_id" = ${userId} AND m."id" = "transactions"."merchant_id" AND unaccent(m."name") ILIKE unaccent(${display}) ESCAPE '\\')`,
      sql`unaccent(${transactions.note}) ILIKE unaccent(${display}) ESCAPE '\\'`,
      // Tag names, both sides of the link scoped by user_id.
      sql`EXISTS (SELECT 1 FROM "transaction_tags" tt INNER JOIN "tags" g ON g."id" = tt."tag_id" AND g."user_id" = ${userId} WHERE tt."user_id" = ${userId} AND tt."transaction_id" = "transactions"."id" AND unaccent(g."name") ILIKE unaccent(${display}) ESCAPE '\\')`,
    );
    if (search) conditions.push(search);
  }

  if (filters.from) conditions.push(gte(transactions.date, filters.from));
  if (filters.to) conditions.push(lte(transactions.date, filters.to));

  // A split row matches through its parts; its own category column is ignored while split.
  // `sp` subqueries are scoped by user_id and correlate on the explicit "transactions"."id".
  const partMatches = (categoryCondition: SQL) =>
    sql`EXISTS (SELECT 1 FROM "transaction_splits" sp WHERE sp."user_id" = ${userId} AND sp."transaction_id" = "transactions"."id" AND ${categoryCondition})`;
  if (filters.category === "none") {
    conditions.push(
      or(
        and(notSplit(userId), sql`${transactions.categoryId} IS NULL`),
        partMatches(partCategoryCondition(userId, "none", sql`sp."category_id"`)),
      ) as SQL,
    );
  } else if (filters.category) {
    conditions.push(
      or(
        and(
          notSplit(userId),
          or(
            eq(transactions.categoryId, filters.category),
            sql`${transactions.categoryId} IN (${childCategoryIds(userId, filters.category)})`,
          ),
        ),
        partMatches(partCategoryCondition(userId, filters.category, sql`sp."category_id"`)),
      ) as SQL,
    );
  }

  // Another user's account id matches nothing: the user_id condition above still applies.
  if (filters.account) conditions.push(eq(transactions.accountId, filters.account));
  // Same for a merchant id: another user's merchant matches no row of this user.
  if (filters.merchant) conditions.push(eq(transactions.merchantId, filters.merchant));

  // Same for a tag id: the link and tag rows are scoped by user_id, so another user's tag matches nothing.
  if (filters.tag) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM "transaction_tags" tt WHERE tt."user_id" = ${userId} AND tt."transaction_id" = "transactions"."id" AND tt."tag_id" = ${filters.tag})`,
    );
  }

  if (filters.direction === "out") conditions.push(sql`${transactions.amountCents} < 0`);
  if (filters.direction === "in") conditions.push(sql`${transactions.amountCents} > 0`);
  if (filters.min !== undefined) conditions.push(sql`abs(${transactions.amountCents}) >= ${filters.min}`);
  if (filters.max !== undefined) conditions.push(sql`abs(${transactions.amountCents}) <= ${filters.max}`);

  if (filters.transfers === "hide") conditions.push(notInTransfer(userId));
  if (filters.transfers === "only") conditions.push(inTransfer(userId));

  // Ignored rows are hidden unless asked for.
  if (filters.ignored === undefined) conditions.push(notIgnored());
  if (filters.ignored === "only") conditions.push(sql`${transactions.ignoredAt} IS NOT NULL`);
  if (filters.review === "todo") conditions.push(sql`${transactions.reviewedAt} IS NULL`);

  if (cursor) {
    conditions.push(
      sql`(${transactions.date}, ${transactions.id}) < (${cursor.date}::date, ${cursor.id}::uuid)`,
    );
  }

  return and(...conditions) as SQL;
}

const listItemParent = alias(categories, "parent_category");

/**
 * The list's select and joins (account, category, its parent, merchant), before any where or
 * order. Shared with the review queue so both build the same `TransactionListItem`.
 * Every join is scoped by userId, so a foreign id can never leak another user's data.
 */
export function selectListItemRows(database: typeof dbClient, userId: string) {
  return database
    .select({
      id: transactions.id,
      date: transactions.date,
      amountCents: transactions.amountCents,
      labelDisplay: transactions.labelDisplay,
      labelRaw: transactions.labelRaw,
      note: transactions.note,
      reviewed: sql<boolean>`${transactions.reviewedAt} is not null`,
      ignored: sql<boolean>`${transactions.ignoredAt} is not null`,
      source: transactions.source,
      importKind: imports.kind,
      awaitingBank: transactions.awaitingBank,
      importedAt: imports.uploadedAt,
      merchantId: merchants.id,
      merchantName: merchants.name,
      accountId: transactions.accountId,
      accountName: accounts.name,
      categorySource: transactions.categorySource,
      categoryId: categories.id,
      categoryName: categories.name,
      categoryColor: categories.color,
      categoryIcon: categories.icon,
      parentName: listItemParent.name,
      recurringId: recurring.id,
      recurringSource: recurring.source,
    })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.userId, userId)))
    .innerJoin(imports, and(eq(imports.id, transactions.importId), eq(imports.userId, userId)))
    .leftJoin(
      categories,
      and(eq(categories.id, transactions.categoryId), eq(categories.userId, userId)),
    )
    .leftJoin(listItemParent, and(eq(listItemParent.id, categories.parentId), eq(listItemParent.userId, userId)))
    .leftJoin(merchants, and(eq(merchants.id, transactions.merchantId), eq(merchants.userId, userId)))
    .leftJoin(recurring, and(eq(recurring.id, transactions.recurringId), eq(recurring.userId, userId)));
}

export type ListItemRow = Awaited<ReturnType<typeof selectListItemRows>>[number];

/** Maps rows from `selectListItemRows` to list items, loading transfer info and split parts (scoped by user_id). */
export async function toListItems(
  database: typeof dbClient,
  userId: string,
  rows: readonly ListItemRow[],
): Promise<TransactionListItem[]> {
  const ids = rows.map((r) => r.id);
  const transferByTx = await loadTransferInfo(database, userId, ids);
  const partsByTx = await loadSplitParts(database, userId, ids);
  const tagsByTx = await loadTransactionTags(database, userId, ids);
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    amountCents: r.amountCents,
    label: r.merchantName ?? r.labelDisplay ?? r.labelRaw ?? "",
    bankLabel: r.labelRaw,
    shortLabel: r.labelDisplay ?? r.labelRaw ?? "",
    merchant: r.merchantId !== null && r.merchantName !== null ? { id: r.merchantId, name: r.merchantName } : null,
    accountId: r.accountId,
    accountName: r.accountName,
    category:
      r.categoryId !== null && r.categoryName !== null && r.categoryColor !== null
        ? { id: r.categoryId, name: r.categoryName, color: r.categoryColor, icon: r.categoryIcon, parentName: r.parentName }
        : null,
    categorySource: r.categorySource,
    transfer: transferByTx.get(r.id) ?? null,
    split: partsByTx.has(r.id) ? { parts: partsByTx.get(r.id) ?? [] } : null,
    note: r.note,
    tags: tagsByTx.get(r.id) ?? [],
    reviewed: r.reviewed,
    ignored: r.ignored,
    recurring: r.recurringId !== null && r.recurringSource !== null ? { id: r.recurringId, tracked: r.recurringSource === "manual" } : null,
    origin: { source: r.source, importKind: r.importKind, awaitingBank: r.awaitingBank, importedAt: r.importedAt },
  }));
}

export async function listTransactions(
  database: typeof dbClient,
  userId: string,
  filters: TransactionFilters,
  cursor: Cursor | null,
  limit = PAGE_SIZE,
): Promise<{ items: TransactionListItem[]; nextCursor: Cursor | null }> {
  // One extra row tells us whether another page exists.
  const rows = await selectListItemRows(database, userId)
    .where(buildWhere(userId, filters, cursor))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(limit + 1);

  const items = await toListItems(database, userId, rows.slice(0, limit));
  const last = items[items.length - 1];
  const nextCursor = rows.length > limit && last ? { date: last.date, id: last.id } : null;
  return { items, nextCursor };
}

/** Transfer info for a page of transactions, keyed by transaction id (scoped by user_id). */
export async function loadTransferInfo(
  database: typeof dbClient,
  userId: string,
  ids: string[],
): Promise<Map<string, NonNullable<TransactionListItem["transfer"]>>> {
  const result = new Map<string, NonNullable<TransactionListItem["transfer"]>>();
  if (ids.length === 0) return result;
  const outTx = alias(transactions, "out_tx");
  const inTx = alias(transactions, "in_tx");
  const outAccount = alias(accounts, "out_account");
  const inAccount = alias(accounts, "in_account");
  const rows = await database
    .select({
      id: transfers.id,
      status: transfers.status,
      outId: outTx.id,
      outDate: outTx.date,
      outAmount: outTx.amountCents,
      outAccountName: outAccount.name,
      inId: inTx.id,
      inDate: inTx.date,
      inAmount: inTx.amountCents,
      inAccountName: inAccount.name,
    })
    .from(transfers)
    .innerJoin(outTx, and(eq(outTx.id, transfers.outTransactionId), eq(outTx.userId, userId)))
    .innerJoin(inTx, and(eq(inTx.id, transfers.inTransactionId), eq(inTx.userId, userId)))
    .innerJoin(outAccount, and(eq(outAccount.id, outTx.accountId), eq(outAccount.userId, userId)))
    .innerJoin(inAccount, and(eq(inAccount.id, inTx.accountId), eq(inAccount.userId, userId)))
    .where(
      and(
        eq(transfers.userId, userId),
        or(inArray(transfers.outTransactionId, ids), inArray(transfers.inTransactionId, ids)),
      ),
    );
  for (const r of rows) {
    result.set(r.outId, {
      id: r.id,
      status: r.status,
      counterpartAccountName: r.inAccountName,
      counterpartDate: r.inDate,
      counterpartAmountCents: r.inAmount,
    });
    result.set(r.inId, {
      id: r.id,
      status: r.status,
      counterpartAccountName: r.outAccountName,
      counterpartDate: r.outDate,
      counterpartAmountCents: r.outAmount,
    });
  }
  return result;
}

export async function countTransactions(
  database: typeof dbClient,
  userId: string,
  filters: TransactionFilters,
): Promise<number> {
  const [row] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(transactions)
    .where(buildWhere(userId, filters, null));
  return row?.total ?? 0;
}

export interface TransactionTotals {
  /** Sum of the negative amounts in integer cents (zero or negative). */
  outCents: number;
  /** Sum of the positive amounts in integer cents. */
  inCents: number;
}

/**
 * Totals for the rows matching the filters (same `buildWhere` as the list and the count).
 * Under a category filter a split row contributes only its matching parts (each with its own
 * amount and sign); otherwise, and for unsplit rows, the full amount. Summed as bigint in SQL
 * so 32-bit cents can't overflow; the results fit a JS number for any realistic history.
 */
export async function sumTransactions(
  database: typeof dbClient,
  userId: string,
  filters: TransactionFilters,
): Promise<TransactionTotals> {
  const where = buildWhere(userId, filters, null);
  const totals = (amount: SQL) => ({
    out: sql<string>`coalesce(sum(CASE WHEN ${amount} < 0 THEN ${amount} END), 0)::text`,
    in: sql<string>`coalesce(sum(CASE WHEN ${amount} > 0 THEN ${amount} END), 0)::text`,
  });

  const category = filters.category;
  const [whole] = await database
    .select(totals(sql`${transactions.amountCents}`))
    .from(transactions)
    // Split rows are counted through their parts below when a category filter narrows them.
    .where(category ? and(where, notSplit(userId)) : where);
  let outCents = Number(whole?.out ?? 0);
  let inCents = Number(whole?.in ?? 0);

  if (category) {
    const [parts] = await database
      .select(totals(sql`${transactionSplits.amountCents}`))
      .from(transactionSplits)
      .innerJoin(
        transactions,
        and(eq(transactions.id, transactionSplits.transactionId), eq(transactions.userId, userId)),
      )
      .where(
        and(
          where,
          eq(transactionSplits.userId, userId),
          partCategoryCondition(userId, category, sql`${transactionSplits.categoryId}`),
        ),
      );
    outCents += Number(parts?.out ?? 0);
    inCents += Number(parts?.in ?? 0);
  }
  return { outCents, inCents };
}

/**
 * Net cents per date for the given dates, with exactly the filter semantics of
 * `sumTransactions` (same `buildWhere`; under a category filter a split row contributes only
 * its matching parts). Dates with no matching row are absent. Scoped by user_id.
 */
export async function sumTransactionsByDay(
  database: typeof dbClient,
  userId: string,
  filters: TransactionFilters,
  dates: string[],
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  if (dates.length === 0) return result;
  const where = and(buildWhere(userId, filters, null), inArray(transactions.date, dates)) as SQL;
  const net = (amount: SQL) => sql<string>`coalesce(sum(${amount}), 0)::text`;

  const category = filters.category;
  const whole = await database
    .select({ date: transactions.date, net: net(sql`${transactions.amountCents}`) })
    .from(transactions)
    // Split rows are counted through their parts below when a category filter narrows them.
    .where(category ? and(where, notSplit(userId)) : where)
    .groupBy(transactions.date);
  for (const r of whole) result[r.date] = (result[r.date] ?? 0) + Number(r.net);

  if (category) {
    const parts = await database
      .select({ date: transactions.date, net: net(sql`${transactionSplits.amountCents}`) })
      .from(transactionSplits)
      .innerJoin(
        transactions,
        and(eq(transactions.id, transactionSplits.transactionId), eq(transactions.userId, userId)),
      )
      .where(
        and(
          where,
          eq(transactionSplits.userId, userId),
          partCategoryCondition(userId, category, sql`${transactionSplits.categoryId}`),
        ),
      )
      .groupBy(transactions.date);
    for (const r of parts) result[r.date] = (result[r.date] ?? 0) + Number(r.net);
  }
  return result;
}

export interface CategoryDisplay {
  id: string;
  name: string;
  color: string;
  /** A top-level category's own icon; null for a subcategory. */
  icon: string | null;
  parentName: string | null;
}

/** Display info for an owned category, resolving its parent's name (scoped by user_id). */
export async function toCategoryDisplay(
  database: Pick<typeof dbClient, "select">,
  userId: string,
  category: { id: string; name: string; color: string; icon: string | null; parentId: string | null },
): Promise<CategoryDisplay> {
  let parentName: string | null = null;
  if (category.parentId) {
    const [parent] = await database
      .select({ name: categories.name })
      .from(categories)
      .where(and(eq(categories.id, category.parentId), eq(categories.userId, userId)))
      .limit(1);
    parentName = parent?.name ?? null;
  }
  return {
    id: category.id,
    name: category.name,
    color: category.color,
    icon: category.icon ?? null,
    parentName,
  };
}

export interface CategorizedTransaction {
  category: CategoryDisplay | null;
  categorySource: "manual" | null;
}

/**
 * Manual (re)categorization. `null` clears the category and its source
 * together so rules may categorize the row again. Returns null when the
 * transaction or the category isn't the user's.
 */
export async function setTransactionCategory(
  database: typeof dbClient,
  userId: string,
  transactionId: string,
  categoryId: string | null,
): Promise<CategorizedTransaction | null> {
  const category = categoryId === null ? null : await getOwnedCategory(database, userId, categoryId);
  if (categoryId !== null && !category) return null;

  const updated = await database
    .update(transactions)
    // Removing the category puts the row back to review: a row is validated only with a category (SPEC §73 B).
    .set({ categoryId, categorySource: categoryId === null ? null : "manual", reviewedAt: categoryId === null ? null : sql`now()` })
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
    .returning({ id: transactions.id });
  if (updated.length === 0) return null;

  return {
    category: category ? await toCategoryDisplay(database, userId, category) : null,
    categorySource: category ? "manual" : null,
  };
}

export type RestorableCategorySource = "manual" | "rule" | "bank" | "guess";

/**
 * Undo for a category change: puts back a previous category, its source and review state.
 * Like `setTransactionCategory` it does not look at splits. Null when the transaction or the
 * category isn't the user's.
 */
export async function restoreTransactionCategory(
  database: typeof dbClient,
  userId: string,
  transactionId: string,
  previous: { categoryId: string | null; categorySource: RestorableCategorySource | null; reviewed: boolean },
): Promise<{ category: CategoryDisplay | null; categorySource: RestorableCategorySource | null } | null> {
  const category = previous.categoryId === null ? null : await getOwnedCategory(database, userId, previous.categoryId);
  if (previous.categoryId !== null && !category) return null;

  const updated = await database
    .update(transactions)
    .set({
      categoryId: previous.categoryId,
      // A category without a source (or the reverse) would break the "null exactly when" invariant.
      categorySource: category ? (previous.categorySource ?? "manual") : null,
      reviewedAt: previous.reviewed ? sql`now()` : null,
    })
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
    .returning({ id: transactions.id });
  if (updated.length === 0) return null;

  return {
    category: category ? await toCategoryDisplay(database, userId, category) : null,
    categorySource: category ? (previous.categorySource ?? "manual") : null,
  };
}

/**
 * Sets (or clears, with null) the category of many transactions at once, in
 * one DB transaction. Ids that aren't the user's are ignored and not counted.
 * Split transactions are left as they are and counted in `skipped`: a split has no
 * single category. Returns null when the category isn't the user's.
 */
export async function bulkSetTransactionCategory(
  database: typeof dbClient,
  userId: string,
  transactionIds: string[],
  categoryId: string | null,
): Promise<{ updated: number; skipped: number; category: CategoryDisplay | null } | null> {
  if (transactionIds.length === 0) return { updated: 0, skipped: 0, category: null };
  return database.transaction(async (tx) => {
    const owned = categoryId === null ? null : await getOwnedCategory(tx as unknown as typeof dbClient, userId, categoryId);
    if (categoryId !== null && !owned) return null;

    const updated = await tx
      .update(transactions)
      // Removing the category puts the row back to review (SPEC §73 B).
      .set({ categoryId, categorySource: categoryId === null ? null : "manual", reviewedAt: categoryId === null ? null : sql`now()` })
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, transactionIds), notSplit(userId)))
      .returning({ id: transactions.id });

    const [split] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, transactionIds), isSplit(userId)));

    return {
      updated: updated.length,
      skipped: split?.total ?? 0,
      category: owned ? await toCategoryDisplay(tx, userId, owned) : null,
    };
  });
}

/**
 * Sets rows aside (or brings them back) and returns the ids that were the user's and changed.
 * Ignoring also marks the row reviewed, since it leaves Review; un-ignoring leaves
 * `reviewed_at` alone. A leg of an internal transfer is never ignored (the pair has to be
 * unlinked first, so totals stay coherent) and is simply not returned. Already ignored rows keep
 * their original `ignored_at`. Scoped by user_id.
 */
export async function setIgnored(
  database: typeof dbClient,
  userId: string,
  ids: string[],
  ignored: boolean,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const where = and(
    eq(transactions.userId, userId),
    inArray(transactions.id, ids),
    ignored ? notInTransfer(userId) : undefined,
  );
  const rows = await database
    .update(transactions)
    .set(
      ignored
        ? {
            ignoredAt: sql`coalesce(${transactions.ignoredAt}, now())`,
            reviewedAt: sql`coalesce(${transactions.reviewedAt}, now())`,
          }
        : { ignoredAt: null },
    )
    .where(where)
    .returning({ id: transactions.id });
  return rows.map((r) => r.id);
}
