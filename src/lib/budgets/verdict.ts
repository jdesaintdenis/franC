import type { BudgetOverview } from "./progress";

export type BudgetVerdict =
  | { kind: "none" }
  | { kind: "current"; leftCents: number; budgetedCents: number; daysLeft: number }
  | { kind: "pastAllKept"; total: number }
  | { kind: "past"; kept: number; total: number; overCents: number };

/** The one-line summary under the month card: what is left, or how the month's budgets ended. */
export function budgetVerdict(overview: BudgetOverview, args: { isCurrent: boolean; daysLeft: number }): BudgetVerdict {
  const { items, totals } = overview;
  // A finished month without any spending says nothing: "all budgets kept" would be noise.
  if (items.length === 0 || (!args.isCurrent && totals.spentCents === 0)) return { kind: "none" };
  if (args.isCurrent) {
    return {
      kind: "current",
      leftCents: Math.max(0, totals.budgetedCents - totals.spentCents),
      budgetedCents: totals.budgetedCents,
      daysLeft: args.daysLeft,
    };
  }
  const over = items.filter((i) => i.status === "over");
  if (over.length === 0) return { kind: "pastAllKept", total: items.length };
  return {
    kind: "past",
    kept: items.length - over.length,
    total: items.length,
    overCents: over.reduce((sum, i) => sum + i.overCents, 0),
  };
}
