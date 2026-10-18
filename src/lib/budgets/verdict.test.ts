import { describe, expect, it } from "vitest";

import { budgetVerdict } from "./verdict";
import type { BudgetOverview } from "./progress";

const item = (status: "ok" | "near" | "over", overCents = 0) => ({ status, overCents }) as BudgetOverview["items"][number];
const overview = (items: BudgetOverview["items"], budgetedCents = 0, spentCents = 0): BudgetOverview => ({
  items,
  totals: { budgetedCents, spentCents, overCount: items.filter((i) => i.status === "over").length },
});

describe("budgetVerdict", () => {
  it("is none without budgets", () => {
    expect(budgetVerdict(overview([]), { isCurrent: true, daysLeft: 3 })).toEqual({ kind: "none" });
  });

  it("current month: what is left of the budgets, never negative", () => {
    const v = budgetVerdict(overview([item("ok")], 100000, 40000), { isCurrent: true, daysLeft: 24 });
    expect(v).toEqual({ kind: "current", leftCents: 60000, budgetedCents: 100000, daysLeft: 24 });
    const over = budgetVerdict(overview([item("over", 100)], 1000, 1100), { isCurrent: true, daysLeft: 1 });
    expect(over).toMatchObject({ kind: "current", leftCents: 0 });
  });

  it("past month without any spending says nothing", () => {
    expect(budgetVerdict(overview([item("ok")], 1000, 0), { isCurrent: false, daysLeft: 0 })).toEqual({ kind: "none" });
  });

  it("past month: all kept", () => {
    expect(budgetVerdict(overview([item("ok"), item("near")], 1000, 100), { isCurrent: false, daysLeft: 0 })).toEqual({
      kind: "pastAllKept",
      total: 2,
    });
  });

  it("past month: counts the kept budgets and sums the overshoot", () => {
    const v = budgetVerdict(overview([item("ok"), item("over", 1500), item("over", 500)], 3000, 500), { isCurrent: false, daysLeft: 0 });
    expect(v).toEqual({ kind: "past", kept: 1, total: 3, overCents: 2000 });
  });
});
