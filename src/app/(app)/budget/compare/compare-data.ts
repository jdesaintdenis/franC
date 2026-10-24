import { db } from "@/db/client";
import { getBudgetProgress } from "@/db/queries/budgets";
import { getMonthlyHistory, getMonthTotals, getSpendingByCategory } from "@/db/queries/dashboard";
import { compareCategories, type ComparedMonths } from "@/lib/compare/months";
import { currentDate, currentMonth, monthRange } from "@/lib/dashboard/month";

/** One budget's spending in both months, against today's base amount (budgets keep no history). */
export interface BudgetComparison {
  categoryId: string;
  name: string;
  parentName: string | null;
  color: string;
  icon: string | null;
  budgetCents: number;
  aSpentCents: number;
  bSpentCents: number;
}

/**
 * Both months of the Compare page, over all accounts, with the Budget page's own queries so a month
 * here matches that month there (SPEC §89 D1).
 */
export async function loadCompare(userId: string, now: Date, { a, b }: ComparedMonths) {
  const [totalsA, totalsB, byCategoryA, byCategoryB, budgetsA, budgetsB, history] = await Promise.all([
    getMonthTotals(db, userId, monthRange(a)),
    getMonthTotals(db, userId, monthRange(b)),
    getSpendingByCategory(db, userId, monthRange(a)),
    getSpendingByCategory(db, userId, monthRange(b)),
    getBudgetProgress(db, userId, monthRange(a)),
    getBudgetProgress(db, userId, monthRange(b)),
    getMonthlyHistory(db, userId),
  ]);

  const spentInB = new Map(budgetsB.map((row) => [row.categoryId, row.spentCents]));
  const budgets: BudgetComparison[] = budgetsA
    .filter((row) => row.budgetCents > 0)
    .map((row) => ({
      categoryId: row.categoryId,
      name: row.name,
      parentName: row.parentName,
      color: row.color,
      icon: row.icon ?? null,
      budgetCents: row.budgetCents,
      aSpentCents: row.spentCents,
      bSpentCents: spentInB.get(row.categoryId) ?? 0,
    }));

  return {
    today: currentDate(now),
    current: currentMonth(now),
    totals: { a: totalsA, b: totalsB },
    categories: compareCategories(byCategoryA, byCategoryB),
    budgets,
    history,
  };
}
