import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { UNCATEGORIZED_COLOR } from "../../lib/category-color";
import { yearRange } from "../../lib/year/year";
import type { db as dbClient } from "../client";
import { categories, transactions } from "../schema";
import {
  inRange,
  toCents,
  topCategoryColumns,
  type AccountScope,
} from "./dashboard";
import { categoryLines } from "./split-sql";

export interface CategoryMonthSpending {
  categoryId: string | null;
  /** Null = money without a category; the page labels it (`labelUncategorized`). */
  name: string | null;
  color: string;
  icon: string | null;
  /** "YYYY-MM" */
  month: string;
  /** Positive. */
  spentCents: number;
}

export interface IncomeSource {
  categoryId: string | null;
  /** Null = money without a category; the page labels it (`labelUncategorized`). */
  name: string | null;
  color: string;
  icon: string | null;
  amountCents: number;
}

// Outflows per top-level category and month, from category lines (a split counts once per
// part) with internal transfers excluded, exactly like the dashboard's category breakdown.
export async function getCategorySpendingByMonth(
  database: typeof dbClient,
  userId: string,
  year: number,
  scope?: AccountScope,
): Promise<CategoryMonthSpending[]> {
  const parent = alias(categories, "parent_category");
  const lines = categoryLines(database, userId, inRange(userId, yearRange(year), scope));
  const { topId, topName, topColor, topIcon } = topCategoryColumns(parent);
  const month = sql<string>`to_char(${lines.date}, 'YYYY-MM')`;
  const rows = await database
    .select({
      categoryId: sql<string | null>`${topId}`,
      name: topName,
      color: topColor,
      icon: topIcon,
      month,
      spent: sql`-sum(${lines.amountCents})::bigint`,
    })
    .from(lines)
    .leftJoin(categories, and(eq(categories.id, lines.categoryId), eq(categories.userId, userId)))
    .leftJoin(parent, and(eq(parent.id, categories.parentId), eq(parent.userId, userId)))
    .where(sql`${lines.amountCents} < 0`)
    .groupBy(topId, topName, topColor, topIcon, month)
    .orderBy(month, topName);

  return rows.map((r) => ({
    categoryId: r.categoryId,
    name: r.name,
    color: r.color ?? UNCATEGORIZED_COLOR,
    icon: r.icon,
    month: r.month,
    spentCents: toCents(r.spent),
  }));
}

// Mirror of getSpendingByCategory on inflows: where the money came from, by top-level category.
export async function getIncomeBySource(
  database: typeof dbClient,
  userId: string,
  range: { from: string; to: string },
  scope?: AccountScope,
): Promise<IncomeSource[]> {
  const parent = alias(categories, "parent_category");
  const lines = categoryLines(database, userId, inRange(userId, range, scope));
  const income = sql`sum(${lines.amountCents})`;
  const { topId, topName, topColor, topIcon } = topCategoryColumns(parent);
  const rows = await database
    .select({
      categoryId: sql<string | null>`${topId}`,
      name: topName,
      color: topColor,
      icon: topIcon,
      income: sql`${income}::bigint`,
    })
    .from(lines)
    .leftJoin(categories, and(eq(categories.id, lines.categoryId), eq(categories.userId, userId)))
    .leftJoin(parent, and(eq(parent.id, categories.parentId), eq(parent.userId, userId)))
    .where(sql`${lines.amountCents} > 0`)
    .groupBy(topId, topName, topColor, topIcon)
    .orderBy(sql`${income} desc`, topName);

  return rows.map((r) => ({
    categoryId: r.categoryId,
    name: r.name,
    color: r.color ?? UNCATEGORIZED_COLOR,
    icon: r.icon,
    amountCents: toCents(r.income),
  }));
}

/** First "YYYY-MM" of the year with a (non-transfer) transaction, or null. */
export async function getFirstMonthWithData(
  database: typeof dbClient,
  userId: string,
  year: number,
  scope?: AccountScope,
): Promise<string | null> {
  const [row] = await database
    .select({ first: sql<string | null>`to_char(min(${transactions.date}), 'YYYY-MM')` })
    .from(transactions)
    .where(inRange(userId, yearRange(year), scope));
  return row?.first ?? null;
}

/** Calendar years that have at least one transaction, ascending. */
export async function getYearsWithData(
  database: typeof dbClient,
  userId: string,
  scope?: AccountScope,
): Promise<number[]> {
  const year = sql<number>`extract(year from ${transactions.date})::int`;
  const rows = await database
    .selectDistinct({ year })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), scope?.accountId ? eq(transactions.accountId, scope.accountId) : undefined))
    .orderBy(year);
  return rows.map((r) => Number(r.year));
}
