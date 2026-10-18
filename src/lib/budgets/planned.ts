import type { BudgetItem } from "./progress";
import { isInactive, type ForecastEntry } from "../recurring/forecast";
import { coveringBudgetId } from "../safe-to-spend/compute";

/**
 * What a month is expected to cost: every budget in full, plus recurring outflows the budgets
 * don't already cover, both those already paid this month (`paid`) and those still due
 * (`entries`: projections only start after an item's last payment, so the two never overlap).
 * Budgets keep no history, so a past month uses today's amounts (SPEC §74 E).
 */
export function plannedSpendingCents(args: {
  budgets: readonly Pick<BudgetItem, "categoryId" | "availableCents">[];
  entries: readonly Pick<ForecastEntry, "amountCents" | "categoryId" | "status">[];
  /** Regular payments already charged in the month; positive amounts. */
  paid?: readonly { categoryId: string | null; amountCents: number }[];
  parentOf: ReadonlyMap<string, string | null>;
}): number {
  const { budgets, entries, paid = [], parentOf } = args;
  const ids = new Set(budgets.map((b) => b.categoryId));
  const uncovered = (categoryId: string | null) => coveringBudgetId(categoryId, parentOf, ids) === null;
  let total = budgets.reduce((sum, b) => sum + Math.max(0, b.availableCents), 0);
  for (const e of entries) {
    if (e.amountCents >= 0 || isInactive(e.status)) continue;
    if (uncovered(e.categoryId ?? null)) total += -e.amountCents;
  }
  for (const p of paid) if (uncovered(p.categoryId)) total += p.amountCents;
  return total;
}

/**
 * The part of a month's spending its plan never counted: outflows in no budgeted category (nor a
 * subcategory of one) and not linked to a regular payment, uncategorized included.
 */
export function outsideBudgetCents(args: {
  spending: readonly { categoryId: string | null; spentCents: number }[];
  budgetIds: ReadonlySet<string>;
  parentOf: ReadonlyMap<string, string | null>;
}): number {
  const { spending, budgetIds, parentOf } = args;
  return spending.reduce((sum, s) => (coveringBudgetId(s.categoryId, parentOf, budgetIds) === null ? sum + s.spentCents : sum), 0);
}
