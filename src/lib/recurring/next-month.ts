import { plannedSpendingCents } from "../budgets/planned";
import { isInactive, type ForecastEntry } from "./forecast";

export interface NextMonthOutlook {
  /** Expected income. */
  inCents: number;
  /** Outgoing regular payments no budget covers. */
  paymentsCents: number;
  /** Every budget in full. */
  budgetsCents: number;
  /** Income minus payments minus budgets; negative when the month costs more than it brings. */
  leftCents: number;
}

/**
 * What a coming month should leave: expected income minus its plan (every budget in full, plus the
 * outgoing regular payments no budget covers, so a payment is never counted twice).
 */
export function nextMonthOutlook(args: {
  entries: readonly Pick<ForecastEntry, "amountCents" | "categoryId" | "status">[];
  budgets: readonly { categoryId: string; budgetCents: number }[];
  parentOf: ReadonlyMap<string, string | null>;
}): NextMonthOutlook {
  const { entries, budgets, parentOf } = args;
  const inCents = entries.reduce((sum, e) => (e.amountCents > 0 && !isInactive(e.status) ? sum + e.amountCents : sum), 0);
  const budgetsCents = budgets.reduce((sum, b) => sum + Math.max(0, b.budgetCents), 0);
  const planned = plannedSpendingCents({
    budgets: budgets.map((b) => ({ categoryId: b.categoryId, availableCents: b.budgetCents })),
    entries,
    parentOf,
  });
  return { inCents, paymentsCents: planned - budgetsCents, budgetsCents, leftCents: inCents - planned };
}
