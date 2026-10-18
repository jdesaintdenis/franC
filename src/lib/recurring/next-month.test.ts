import { describe, expect, it } from "vitest";

import { nextMonthOutlook } from "./next-month";

const parentOf = new Map<string, string | null>([
  ["food", null],
  ["groceries", "food"],
  ["rent", null],
]);
const entry = (amountCents: number, categoryId: string | null, status: "confirmed" | "detected" | "dismissed" | "ended" = "confirmed") => ({
  amountCents,
  categoryId,
  status,
});

describe("nextMonthOutlook", () => {
  it("without budgets, payments are every outflow", () => {
    const o = nextMonthOutlook({ entries: [entry(200000, null), entry(-50000, "rent"), entry(-1000, null)], budgets: [], parentOf });
    expect(o).toEqual({ inCents: 200000, paymentsCents: 51000, budgetsCents: 0, leftCents: 149000 });
  });

  it("does not count a payment twice when its category has a budget", () => {
    const o = nextMonthOutlook({
      entries: [entry(200000, null), entry(-50000, "rent")],
      budgets: [{ categoryId: "rent", budgetCents: 60000 }],
      parentOf,
    });
    expect(o).toEqual({ inCents: 200000, paymentsCents: 0, budgetsCents: 60000, leftCents: 140000 });
  });

  it("counts a payment in a subcategory of a budgeted parent in the parent's budget", () => {
    const o = nextMonthOutlook({
      entries: [entry(-1000, "groceries")],
      budgets: [{ categoryId: "food", budgetCents: 30000 }],
      parentOf,
    });
    expect(o.paymentsCents).toBe(0);
    expect(o.leftCents).toBe(-30000);
  });

  it("skips dismissed and ended entries", () => {
    const o = nextMonthOutlook({
      entries: [entry(5000, null, "ended"), entry(-900, "rent", "dismissed"), entry(-800, "rent", "ended")],
      budgets: [],
      parentOf,
    });
    expect(o).toEqual({ inCents: 0, paymentsCents: 0, budgetsCents: 0, leftCents: 0 });
  });

  it("counts a negative budget as 0", () => {
    const o = nextMonthOutlook({ entries: [], budgets: [{ categoryId: "food", budgetCents: -500 }], parentOf });
    expect(o.budgetsCents).toBe(0);
  });

  it("goes negative when the month costs more than it brings", () => {
    const o = nextMonthOutlook({ entries: [entry(1000, null)], budgets: [{ categoryId: "food", budgetCents: 5000 }], parentOf });
    expect(o.leftCents).toBe(-4000);
  });
});
