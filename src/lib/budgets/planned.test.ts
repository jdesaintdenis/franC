import { describe, expect, it } from "vitest";

import { outsideBudgetCents, plannedSpendingCents } from "./planned";

const parentOf = new Map<string, string | null>([
  ["food", null],
  ["groceries", "food"],
  ["rent", null],
]);
const entry = (amountCents: number, categoryId: string | null, status = "confirmed" as const) => ({
  amountCents,
  categoryId,
  status,
});

describe("plannedSpendingCents", () => {
  it("is 0 without budgets or entries", () => {
    expect(plannedSpendingCents({ budgets: [], entries: [], parentOf })).toBe(0);
  });

  it("adds an uncovered bill", () => {
    const budgets = [{ categoryId: "food", availableCents: 30000 }];
    expect(plannedSpendingCents({ budgets, entries: [entry(-50000, "rent")], parentOf })).toBe(80000);
  });

  it("does not add a bill in a budgeted category", () => {
    const budgets = [{ categoryId: "rent", availableCents: 50000 }];
    expect(plannedSpendingCents({ budgets, entries: [entry(-50000, "rent")], parentOf })).toBe(50000);
  });

  it("does not add a bill in a subcategory of a budgeted parent", () => {
    const budgets = [{ categoryId: "food", availableCents: 30000 }];
    expect(plannedSpendingCents({ budgets, entries: [entry(-1000, "groceries")], parentOf })).toBe(30000);
  });

  it("adds an uncategorised bill", () => {
    expect(plannedSpendingCents({ budgets: [], entries: [entry(-700, null)], parentOf })).toBe(700);
  });

  it("ignores income and inactive entries", () => {
    const entries = [entry(450000, null), entry(-900, "rent", "dismissed" as never), entry(-800, "rent", "ended" as never)];
    expect(plannedSpendingCents({ budgets: [], entries, parentOf })).toBe(0);
  });

  it("adds regular payments already paid outside a budget", () => {
    const budgets = [{ categoryId: "food", availableCents: 30000 }];
    const paid = [
      { categoryId: "rent", amountCents: 50000 },
      { categoryId: "groceries", amountCents: 1000 },
    ];
    expect(plannedSpendingCents({ budgets, entries: [entry(-2000, "rent")], paid, parentOf })).toBe(82000);
  });

  it("counts a negative available as 0", () => {
    const budgets = [
      { categoryId: "food", availableCents: -3340 },
      { categoryId: "rent", availableCents: 1000 },
    ];
    expect(plannedSpendingCents({ budgets, entries: [], parentOf })).toBe(1000);
  });
});

describe("outsideBudgetCents", () => {
  const budgetIds = new Set(["food"]);

  it("keeps spending no budget covers, uncategorized included", () => {
    const spending = [
      { categoryId: "food", spentCents: 1000 },
      { categoryId: "groceries", spentCents: 2000 },
      { categoryId: "rent", spentCents: 4000 },
      { categoryId: null, spentCents: 800 },
    ];
    expect(outsideBudgetCents({ spending, budgetIds, parentOf })).toBe(4800);
  });

  it("is 0 when every expense is budgeted", () => {
    expect(outsideBudgetCents({ spending: [{ categoryId: "groceries", spentCents: 500 }], budgetIds, parentOf })).toBe(0);
  });
});
