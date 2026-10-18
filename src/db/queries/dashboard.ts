import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";

import { UNCATEGORIZED_COLOR } from "../../lib/category-color";
import { monthRange } from "../../lib/dashboard/month";
import type { MonthHistoryRow } from "../../lib/dashboard/month-picker";
import type { db as dbClient } from "../client";
import { categories, transactions, transfers } from "../schema";
import { categoryLines } from "./split-sql";
import { countable, notIgnored } from "./transfer-sql";

export { UNCATEGORIZED_COLOR };

export interface MonthTotals {
  /** Positive absolute value of all outflows. */
  spentCents: number;
  incomeCents: number;
  /** income - spent */
  netCents: number;
  count: number;
}

export interface CategorySpending {
  categoryId: string | null;
  /** Null = money without a category; the page labels it (`labelUncategorized`). */
  name: string | null;
  color: string;
  /** The top-level category's own icon (a subcategory's spending rolls up into its parent). */
  icon: string | null;
  spentCents: number;
  /** True when part of this top-level total was filed on one of its subcategories. */
  hasSubcategorySpending: boolean;
}

export interface SubcategorySpending {
  categoryId: string;
  name: string;
  color: string;
  /** A top-level category's own icon; null for a subcategory. */
  icon: string | null;
  spentCents: number;
  /** Rows filed on the parent itself, with no subcategory; the UI labels this bucket. */
  isParentItself: boolean;
}

export interface MonthlyTrendRow {
  month: string;
  spentCents: number;
  incomeCents: number;
}

/**
 * SUM over integer columns is bigint, which postgres-js returns as a string.
 * Money must stay exact, so refuse anything that doesn't fit a safe integer.
 */
export function toCents(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(n)) throw new Error("Aggregate is not a safe integer");
  return n;
}

/** Optional narrowing to one account. A foreign account id matches nothing: user_id is always applied. */
export interface AccountScope {
  accountId?: string;
}

function accountCondition(scope: AccountScope | undefined) {
  return scope?.accountId ? eq(transactions.accountId, scope.accountId) : undefined;
}

// Exported for budgets, which must count spending exactly like the dashboard.
// Inclusive date bounds, both as bound parameters. Rows in an internal transfer (either
// status) are never spending or income, so every aggregate goes through here and skips them.
export function inRange(userId: string, range: { from: string; to: string }, scope?: AccountScope) {
  return and(
    eq(transactions.userId, userId),
    gte(transactions.date, range.from),
    lte(transactions.date, range.to),
    accountCondition(scope),
    countable(userId),
  );
}

const spentSql = sql`coalesce(-sum(${transactions.amountCents}) FILTER (WHERE ${transactions.amountCents} < 0), 0)::bigint`;
const incomeSql = sql`coalesce(sum(${transactions.amountCents}) FILTER (WHERE ${transactions.amountCents} > 0), 0)::bigint`;

export async function getMonthTotals(
  database: typeof dbClient,
  userId: string,
  range: { from: string; to: string },
  scope?: AccountScope,
): Promise<MonthTotals> {
  const [row] = await database
    .select({
      spent: spentSql,
      income: incomeSql,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(inRange(userId, range, scope));

  const spentCents = toCents(row?.spent ?? 0);
  const incomeCents = toCents(row?.income ?? 0);
  return { spentCents, incomeCents, netCents: incomeCents - spentCents, count: toCents(row?.count ?? 0) };
}

/**
 * Spending per day of a range over the given accounts (transfers excluded, like the totals).
 * Days without spending are absent. Feeds the Home hero's pace chart.
 */
export async function getDailySpending(
  database: typeof dbClient,
  userId: string,
  range: { from: string; to: string },
  accountIds: string[],
): Promise<{ date: string; spentCents: number }[]> {
  if (accountIds.length === 0) return [];
  const rows = await database
    .select({ date: transactions.date, spent: spentSql })
    .from(transactions)
    .where(and(inRange(userId, range), inArray(transactions.accountId, accountIds)))
    .groupBy(transactions.date)
    .orderBy(transactions.date);
  return rows.map((r) => ({ date: r.date, spentCents: toCents(r.spent) })).filter((r) => r.spentCents > 0);
}

/**
 * SQL for the top-level category a line rolls up into (a subcategory reports as its parent).
 * Shared by every per-category aggregate so they all group and name categories identically.
 */
export function topCategoryColumns(parent: { id: AnyPgColumn; name: AnyPgColumn; color: AnyPgColumn; icon: AnyPgColumn }) {
  return {
    topId: sql`coalesce(${parent.id}, ${categories.id})`,
    topName: sql<string | null>`coalesce(${parent.name}, ${categories.name})`,
    topColor: sql<string | null>`coalesce(${parent.color}, ${categories.color})`,
    topIcon: sql<string | null>`case when ${parent.id} is not null then ${parent.icon} else ${categories.icon} end`,
  };
}

// Outflows only, so a refund in a category never hides what was spent there. Reads category
// lines: a split transaction counts once per part, in the part's category.
// Subcategory spending rolls up into its top-level parent (hierarchy is one level deep).
export async function getSpendingByCategory(
  database: typeof dbClient,
  userId: string,
  range: { from: string; to: string },
  scope?: AccountScope,
): Promise<CategorySpending[]> {
  const parent = alias(categories, "parent_category");
  const lines = categoryLines(database, userId, inRange(userId, range, scope));
  const spent = sql`-sum(${lines.amountCents})`;
  const { topId, topName, topColor, topIcon } = topCategoryColumns(parent);
  const rows = await database
    .select({
      categoryId: sql<string | null>`${topId}`,
      name: topName,
      color: topColor,
      icon: topIcon,
      spent: sql`${spent}::bigint`,
      hasSub: sql<boolean>`coalesce(bool_or(${categories.parentId} is not null), false)`,
    })
    .from(lines)
    .leftJoin(categories, and(eq(categories.id, lines.categoryId), eq(categories.userId, userId)))
    .leftJoin(parent, and(eq(parent.id, categories.parentId), eq(parent.userId, userId)))
    .where(sql`${lines.amountCents} < 0`)
    .groupBy(topId, topName, topColor, topIcon)
    .orderBy(sql`${spent} desc`, topName);

  return rows.map((r) => ({
    categoryId: r.categoryId,
    name: r.name,
    color: r.color ?? UNCATEGORIZED_COLOR,
    icon: r.icon,
    spentCents: toCents(r.spent),
    hasSubcategorySpending: r.hasSub,
  }));
}

/**
 * Breakdown of one top-level category's outflows: one bucket per subcategory
 * plus one for rows filed on the parent itself. Null when `parentId` is not
 * one of the user's top-level categories.
 */
export async function getSubcategorySpending(
  database: typeof dbClient,
  userId: string,
  range: { from: string; to: string },
  parentId: string,
  scope?: AccountScope,
): Promise<SubcategorySpending[] | null> {
  const [top] = await database
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, parentId), eq(categories.userId, userId), isNull(categories.parentId)));
  if (!top) return null;

  const lines = categoryLines(database, userId, inRange(userId, range, scope));
  const spent = sql`-sum(${lines.amountCents})`;
  const rows = await database
    .select({
      categoryId: categories.id,
      name: categories.name,
      color: categories.color,
      icon: categories.icon,
      spent: sql`${spent}::bigint`,
    })
    .from(lines)
    .innerJoin(categories, and(eq(categories.id, lines.categoryId), eq(categories.userId, userId)))
    .where(
      and(
        sql`${lines.amountCents} < 0`,
        or(eq(categories.id, parentId), eq(categories.parentId, parentId)),
      ),
    )
    .groupBy(categories.id, categories.name, categories.color, categories.icon)
    .orderBy(sql`${spent} desc`, categories.name);

  return rows.map((r) => ({
    categoryId: r.categoryId,
    name: r.name,
    color: r.color,
    icon: r.icon,
    spentCents: toCents(r.spent),
    isParentItself: r.categoryId === parentId,
  }));
}

/**
 * The subcategory buckets of every top-level category that has subcategory spending
 * in the range, keyed by the parent's id: the same buckets as `getSubcategorySpending`
 * (including the one for rows filed on the parent itself), in one query, so the chart
 * can show each category's split without another round trip.
 */
export async function getSubcategoryBreakdown(
  database: typeof dbClient,
  userId: string,
  range: { from: string; to: string },
  scope?: AccountScope,
): Promise<Map<string, SubcategorySpending[]>> {
  const parent = alias(categories, "parent_category");
  const topId = sql<string>`coalesce(${parent.id}, ${categories.id})`;
  const lines = categoryLines(database, userId, inRange(userId, range, scope));
  const spent = sql`-sum(${lines.amountCents})`;
  const rows = await database
    .select({
      topId,
      categoryId: categories.id,
      name: categories.name,
      color: categories.color,
      icon: categories.icon,
      spent: sql`${spent}::bigint`,
    })
    .from(lines)
    .innerJoin(categories, and(eq(categories.id, lines.categoryId), eq(categories.userId, userId)))
    .leftJoin(parent, and(eq(parent.id, categories.parentId), eq(parent.userId, userId)))
    .where(sql`${lines.amountCents} < 0`)
    .groupBy(topId, categories.id, categories.name, categories.color, categories.icon)
    .orderBy(sql`${spent} desc`, categories.name);

  const byParent = new Map<string, SubcategorySpending[]>();
  for (const r of rows) {
    const buckets = byParent.get(r.topId) ?? [];
    buckets.push({
      categoryId: r.categoryId,
      name: r.name,
      color: r.color,
      icon: r.icon,
      spentCents: toCents(r.spent),
      isParentItself: r.categoryId === r.topId,
    });
    byParent.set(r.topId, buckets);
  }
  // Only parents with subcategory spending have a breakdown worth showing.
  for (const [id, buckets] of byParent) {
    if (buckets.every((b) => b.isParentItself)) byParent.delete(id);
  }
  return byParent;
}

/** Only months with rows are returned; callers zero-fill with `fillTrend`. */
export async function getMonthlyTrend(
  database: typeof dbClient,
  userId: string,
  fromMonth: string,
  toMonth: string,
  scope?: AccountScope,
): Promise<MonthlyTrendRow[]> {
  const range = { from: monthRange(fromMonth).from, to: monthRange(toMonth).to };
  const month = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;
  const rows = await database
    .select({ month, spent: spentSql, income: incomeSql })
    .from(transactions)
    .where(inRange(userId, range, scope))
    .groupBy(month)
    .orderBy(month);

  return rows.map((r) => ({
    month: r.month,
    spentCents: toCents(r.spent),
    incomeCents: toCents(r.income),
  }));
}

/**
 * Every month with transactions, oldest first, for the month picker: the trend's totals plus a
 * row count so "has data" doesn't depend on spending being non-zero. Same exclusions as the
 * trend (internal transfers), counted on whole transactions.
 */
export async function getMonthlyHistory(
  database: typeof dbClient,
  userId: string,
  scope?: AccountScope,
): Promise<MonthHistoryRow[]> {
  const month = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;
  const rows = await database
    .select({ month, spent: spentSql, income: incomeSql, count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), accountCondition(scope), countable(userId)))
    .groupBy(month)
    .orderBy(month);

  return rows.map((r) => ({
    month: r.month,
    spentCents: toCents(r.spent),
    incomeCents: toCents(r.income),
    count: toCents(r.count),
  }));
}

/**
 * Number of transfer pairs with at least one leg in the range (and, when scoped, on
 * that account). A pair counts once, even when both legs are in range. Unlike the
 * aggregates above, this counts what they leave out.
 */
export async function countTransfersInRange(
  database: typeof dbClient,
  userId: string,
  range: { from: string; to: string },
  scope?: AccountScope,
): Promise<number> {
  const account = scope?.accountId ? sql`AND t."account_id" = ${scope.accountId}` : sql``;
  const [row] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(transfers)
    .where(
      and(
        eq(transfers.userId, userId),
        sql`EXISTS (SELECT 1 FROM "transactions" t
          WHERE t."user_id" = ${userId}
            AND t."id" IN ("transfers"."out_transaction_id", "transfers"."in_transaction_id")
            AND t."date" >= ${range.from} AND t."date" <= ${range.to} ${account})`,
      ),
    );
  return row?.total ?? 0;
}

export async function getLatestTransactionMonth(
  database: typeof dbClient,
  userId: string,
  scope?: AccountScope,
): Promise<string | null> {
  const [row] = await database
    .select({ latest: sql<string | null>`to_char(max(${transactions.date}), 'YYYY-MM')` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), accountCondition(scope), notIgnored()));
  return row?.latest ?? null;
}
