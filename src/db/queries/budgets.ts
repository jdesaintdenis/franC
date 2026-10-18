import { and, eq, isNotNull, isNull, min, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { presetsFrom, type BudgetPresets } from "../../lib/budgets/presets";
import type { BudgetRow } from "../../lib/budgets/progress";
import { budgetSnapshotSchema, type BudgetSnapshot } from "../../lib/budgets/snapshot";
import {
  computeCarry,
  monthOf,
  rollUpMonthlySpending,
  type MonthlySpendingRow,
  type RolloverSetting,
  type SpendingByMonth,
} from "../../lib/budgets/rollover";
import { addMonths, currentMonth, monthRange } from "../../lib/dashboard/month";
import type { db as dbClient } from "../client";
import { categories, categoryBudgets, transactions } from "../schema";
import { inRange, toCents } from "./dashboard";
import { categoryLines } from "./split-sql";

type Selectable = Pick<typeof dbClient, "select">;

export interface BudgetSetting {
  categoryId: string;
  amountCents: number;
  rollover: boolean;
}

export type SetBudgetResult =
  | { ok: true; /** Rollover was on and is now off, so the carry is gone. */ carryReset?: true }
  | { ok: false; error: "not_found" };

export async function listBudgets(database: typeof dbClient, userId: string): Promise<BudgetSetting[]> {
  return database
    .select({
      categoryId: categoryBudgets.categoryId,
      amountCents: categoryBudgets.amountCents,
      rollover: categoryBudgets.rollover,
    })
    .from(categoryBudgets)
    .where(eq(categoryBudgets.userId, userId));
}

export interface RecurringChargeRow {
  recurringId: string;
  date: string;
  /** Positive. */
  amountCents: number;
  categoryId: string;
}

/**
 * Outflow lines of the range linked to a regular payment, one per category line (a split part
 * counts in its own category). The names come from the recurring list, so no join here.
 */
export async function getRecurringCharges(
  database: Selectable,
  userId: string,
  range: { from: string; to: string },
): Promise<RecurringChargeRow[]> {
  const lines = categoryLines(database, userId, inRange(userId, range));
  const rows = await database
    .select({
      recurringId: sql<string>`${lines.recurringId}`,
      date: sql<string>`${lines.date}`,
      amountCents: sql<string>`-${lines.amountCents}`,
      categoryId: sql<string>`${lines.categoryId}`,
    })
    .from(lines)
    .where(and(sql`${lines.amountCents} < 0`, isNotNull(lines.categoryId), isNotNull(lines.recurringId)))
    .orderBy(lines.date);
  return rows.map((r) => ({ ...r, amountCents: toCents(r.amountCents) }));
}

/**
 * Own-category outflows per month in the range, by category line (splits counted per part),
 * transfers excluded: the same spending as `getBudgetProgress`, before the parent roll-up.
 */
export async function getMonthlyCategorySpending(
  database: Selectable,
  userId: string,
  range: { from: string; to: string },
): Promise<MonthlySpendingRow[]> {
  const lines = categoryLines(database, userId, inRange(userId, range));
  const month = sql<string>`to_char(${lines.date}, 'YYYY-MM')`;
  const rows = await database
    .select({
      categoryId: sql<string>`${lines.categoryId}`,
      month,
      spent: sql<string>`-sum(${lines.amountCents})`,
    })
    .from(lines)
    .where(and(sql`${lines.amountCents} < 0`, isNotNull(lines.categoryId)))
    .groupBy(lines.categoryId, month);
  return rows.map((r) => ({ categoryId: r.categoryId, month: r.month, spentCents: toCents(r.spent) }));
}

async function parentMap(database: Selectable, userId: string): Promise<Map<string, string | null>> {
  const rows = await database
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(eq(categories.userId, userId));
  return new Map(rows.map((r) => [r.id, r.parentId]));
}

/** Rolled-up spending per category and month, over the months from `fromMonth` to `toMonth` inclusive. */
async function rolledUpSpending(
  database: Selectable,
  userId: string,
  fromMonth: string,
  toMonth: string,
): Promise<SpendingByMonth> {
  const range = { from: monthRange(fromMonth).from, to: monthRange(toMonth).to };
  const [rows, parents] = await Promise.all([
    getMonthlyCategorySpending(database, userId, range),
    parentMap(database, userId),
  ]);
  return rollUpMonthlySpending(rows, parents);
}

/** Carry into `month` for each budget with rollover on, keyed by category id. */
async function carriesInto(
  database: Selectable,
  userId: string,
  settings: ReadonlyMap<string, RolloverSetting>,
  month: string,
): Promise<Map<string, number | null>> {
  const carries = new Map<string, number | null>();
  const earlier = [...settings.values()].filter((s) => s.startMonth < month).map((s) => s.startMonth);
  // Nothing to add up when every rollover starts this month or later: skip the query.
  const spending =
    earlier.length === 0
      ? new Map<string, Map<string, number>>()
      : await rolledUpSpending(database, userId, earlier.reduce((a, b) => (a < b ? a : b)), addMonths(month, -1));
  for (const [categoryId, setting] of settings) {
    carries.set(categoryId, computeCarry(setting, spending.get(categoryId), month));
  }
  return carries;
}

/**
 * Upserts the budget of one of the user's categories. Another user's category is "not_found".
 * `rollover` undefined keeps the current setting. Rollover starts in `month` (the current one)
 * when turned on. Changing the amount while it is on first snapshots the carry built so far,
 * so the new amount doesn't rewrite past months (budgets keep no history).
 */
export async function setBudget(
  database: typeof dbClient,
  userId: string,
  categoryId: string,
  amountCents: number,
  options: { rollover?: boolean; month?: string } = {},
): Promise<SetBudgetResult> {
  return database.transaction(async (tx): Promise<SetBudgetResult> => {
    const [owned] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .limit(1);
    if (!owned) return { ok: false, error: "not_found" };

    const [existing] = await tx
      .select({
        amountCents: categoryBudgets.amountCents,
        rollover: categoryBudgets.rollover,
        rolloverStart: categoryBudgets.rolloverStart,
        rolloverBaseCents: categoryBudgets.rolloverBaseCents,
      })
      .from(categoryBudgets)
      .where(and(eq(categoryBudgets.categoryId, categoryId), eq(categoryBudgets.userId, userId)))
      .for("update");

    const month = options.month ?? currentMonth(new Date());
    const rollover = options.rollover ?? existing?.rollover ?? false;
    let rolloverStart: string | null = null;
    let rolloverBaseCents = 0;
    if (rollover && existing?.rollover && existing.rolloverStart !== null) {
      rolloverStart = existing.rolloverStart;
      rolloverBaseCents = existing.rolloverBaseCents;
      const startMonth = monthOf(existing.rolloverStart);
      if (existing.amountCents !== amountCents && startMonth < month) {
        const setting = { amountCents: existing.amountCents, startMonth, baseCents: existing.rolloverBaseCents };
        const carries = await carriesInto(tx, userId, new Map([[categoryId, setting]]), month);
        rolloverBaseCents = carries.get(categoryId) ?? 0;
        rolloverStart = `${month}-01`;
      }
    } else if (rollover) {
      rolloverStart = `${month}-01`;
    }

    const values = { amountCents, rollover, rolloverStart, rolloverBaseCents };
    await tx
      .insert(categoryBudgets)
      .values({ categoryId, userId, ...values })
      .onConflictDoUpdate({
        target: categoryBudgets.categoryId,
        set: { ...values, updatedAt: new Date() },
        // Belt and braces: the composite FK already ties the row to its owner.
        setWhere: eq(categoryBudgets.userId, userId),
      });
    return existing?.rollover && !rollover ? { ok: true, carryReset: true } : { ok: true };
  });
}

/**
 * Removes the budget and returns the row as it was, so Undo can put it back exactly.
 * Removing a budget that does not exist is a no-op (null).
 */
export async function removeBudget(
  database: typeof dbClient,
  userId: string,
  categoryId: string,
): Promise<BudgetSnapshot | null> {
  const [removed] = await database
    .delete(categoryBudgets)
    .where(and(eq(categoryBudgets.categoryId, categoryId), eq(categoryBudgets.userId, userId)))
    .returning({
      categoryId: categoryBudgets.categoryId,
      amountCents: categoryBudgets.amountCents,
      rollover: categoryBudgets.rollover,
      rolloverStart: categoryBudgets.rolloverStart,
      rolloverBaseCents: categoryBudgets.rolloverBaseCents,
    });
  return removed ?? null;
}

export type RestoreBudgetResult = { ok: true } | { ok: false; error: "invalid" | "not_found" };

/**
 * Puts a removed budget back as it was (amount, rollover, its start and carried base). The
 * snapshot comes from the client, so it is validated first and the category must be the
 * user's. A budget added meanwhile for the same category is replaced: Undo is explicit.
 */
export async function restoreBudget(
  database: typeof dbClient,
  userId: string,
  snapshot: unknown,
): Promise<RestoreBudgetResult> {
  const parsed = budgetSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { categoryId, amountCents, rollover, rolloverStart, rolloverBaseCents } = parsed.data;
  return database.transaction(async (tx): Promise<RestoreBudgetResult> => {
    const [owned] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .limit(1);
    if (!owned) return { ok: false, error: "not_found" };
    const values = { amountCents, rollover, rolloverStart, rolloverBaseCents };
    await tx
      .insert(categoryBudgets)
      .values({ categoryId, userId, ...values })
      .onConflictDoUpdate({
        target: categoryBudgets.categoryId,
        set: { ...values, updatedAt: new Date() },
        setWhere: eq(categoryBudgets.userId, userId),
      });
    return { ok: true };
  });
}

/**
 * One-click amounts for every category of the user, from the 3 full months before
 * `currentMonth` (rolled up like budgets). Categories with no spending are absent.
 */
export async function getBudgetPresets(
  database: typeof dbClient,
  userId: string,
  currentMonth: string,
): Promise<Map<string, BudgetPresets>> {
  const [first] = await database
    .select({ date: min(transactions.date) })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  const firstDataMonth = first?.date ? monthOf(first.date) : null;
  const presets = new Map<string, BudgetPresets>();
  if (firstDataMonth === null) return presets;

  const spending = await rolledUpSpending(database, userId, addMonths(currentMonth, -3), addMonths(currentMonth, -1));
  for (const [categoryId, months] of spending) {
    const p = presetsFrom(months, currentMonth, firstDataMonth);
    if (p.lastMonthCents > 0 || p.averageCents > 0) presets.set(categoryId, p);
  }
  return presets;
}

/**
 * One row per budgeted category with its spending in the range: outflows only, internal
 * transfers excluded (same conditions as the dashboard). A top-level category's spending
 * is its own plus its subcategories'; a subcategory's is its own. The range is a calendar
 * month (`monthRange`): budgets with rollover get the carry into that month.
 */
export async function getBudgetProgress(
  database: typeof dbClient,
  userId: string,
  range: { from: string; to: string },
): Promise<BudgetRow[]> {
  // Category lines: a split transaction counts once per part, in the part's category.
  const lines = categoryLines(database, userId, inRange(userId, range));
  const spending = database.$with("spending").as(
    database
      .select({
        categoryId: sql<string>`${lines.categoryId}`.as("category_id"),
        spent: sql<string>`-sum(${lines.amountCents})`.as("spent"),
        recurringSpent: sql<string>`coalesce(-sum(${lines.amountCents}) FILTER (WHERE ${lines.recurringId} IS NOT NULL), 0)`.as(
          "recurring_spent",
        ),
      })
      .from(lines)
      .where(and(sql`${lines.amountCents} < 0`, isNotNull(lines.categoryId)))
      .groupBy(lines.categoryId),
  );

  const parent = alias(categories, "parent_category");

  // Own outflows plus those of direct subcategories (one level deep); a subcategory has none.
  // Written against the CTE by name: drizzle cannot alias a CTE or join it twice.
  const rolledUp = (column: "spent" | "recurring_spent") => sql`coalesce((
    SELECT sum("spending".${sql.identifier(column)}) FROM "spending"
    WHERE "spending"."category_id" = ${categories.id}
      OR "spending"."category_id" IN (
        SELECT ch."id" FROM "categories" ch WHERE ch."parent_id" = ${categories.id} AND ch."user_id" = ${userId}
      )
  ), 0)::bigint`;

  const rows = await database
    .with(spending)
    .select({
      categoryId: categories.id,
      name: categories.name,
      color: categories.color,
      // The category's own icon (subcategories included, SPEC §66).
      icon: categories.icon,
      parentId: categories.parentId,
      parentName: parent.name,
      parentColor: parent.color,
      budgetCents: categoryBudgets.amountCents,
      spent: rolledUp("spent"),
      recurringSpent: rolledUp("recurring_spent"),
      rollover: categoryBudgets.rollover,
      rolloverStart: categoryBudgets.rolloverStart,
      rolloverBaseCents: categoryBudgets.rolloverBaseCents,
    })
    .from(categoryBudgets)
    .innerJoin(
      categories,
      and(eq(categories.id, categoryBudgets.categoryId), eq(categories.userId, userId)),
    )
    .leftJoin(parent, and(eq(parent.id, categories.parentId), eq(parent.userId, userId)))
    .where(eq(categoryBudgets.userId, userId))
    .orderBy(categories.name);

  const month = monthOf(range.from);
  const settings = new Map<string, RolloverSetting>();
  for (const r of rows) {
    if (r.rollover && r.rolloverStart !== null) {
      settings.set(r.categoryId, {
        amountCents: r.budgetCents,
        startMonth: monthOf(r.rolloverStart),
        baseCents: r.rolloverBaseCents,
      });
    }
  }
  const carries = settings.size === 0 ? new Map<string, number | null>() : await carriesInto(database, userId, settings, month);

  return rows.map((r) => ({
    categoryId: r.categoryId,
    name: r.name,
    color: r.color,
    icon: r.icon,
    parentId: r.parentId,
    parentName: r.parentName,
    parentColor: r.parentColor,
    budgetCents: r.budgetCents,
    spentCents: toCents(r.spent),
    recurringSpentCents: toCents(r.recurringSpent),
    carryCents: carries.get(r.categoryId) ?? null,
  }));
}

/**
 * Outflows of the range per category (null = uncategorized) that are not linked to a regular
 * payment: split parts counted in their own category, transfers and ignored rows excluded.
 * The Budget page keeps those no budget covers to say how much of the month was never planned.
 */
export async function getUnlinkedSpendingByCategory(
  database: typeof dbClient,
  userId: string,
  range: { from: string; to: string },
): Promise<{ categoryId: string | null; spentCents: number }[]> {
  const lines = categoryLines(database, userId, inRange(userId, range));
  const rows = await database
    .select({ categoryId: lines.categoryId, spent: sql<string>`-sum(${lines.amountCents})` })
    .from(lines)
    .where(and(sql`${lines.amountCents} < 0`, isNull(lines.recurringId)))
    .groupBy(lines.categoryId);
  return rows.map((r) => ({ categoryId: r.categoryId, spentCents: toCents(r.spent) }));
}
