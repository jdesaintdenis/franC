import { describe, expect, it } from "vitest";

import { buildBudgetOverview, type BudgetRow } from "./progress";

function row(over: Partial<BudgetRow> & Pick<BudgetRow, "categoryId" | "budgetCents" | "spentCents">): BudgetRow {
  return { name: over.categoryId, color: "#000000", parentId: null, parentName: null, ...over };
}

describe("buildBudgetOverview", () => {
  it("returns nothing for no budgets", () => {
    expect(buildBudgetOverview([])).toEqual({
      items: [],
      totals: { budgetedCents: 0, spentCents: 0, overCount: 0 },
    });
  });

  it("computes remaining, over and status edges", () => {
    const { items } = buildBudgetOverview([
      row({ categoryId: "zero", budgetCents: 10000, spentCents: 0 }),
      row({ categoryId: "under90", budgetCents: 10000, spentCents: 8999 }),
      row({ categoryId: "at90", budgetCents: 10000, spentCents: 9000 }),
      row({ categoryId: "at100", budgetCents: 10000, spentCents: 10000 }),
      row({ categoryId: "over1", budgetCents: 10000, spentCents: 10001 }),
    ]);
    const by = Object.fromEntries(items.map((i) => [i.categoryId, i]));
    expect(by.zero).toMatchObject({ status: "ok", remainingCents: 10000, overCents: 0 });
    expect(by.under90).toMatchObject({ status: "ok", remainingCents: 1001, overCents: 0 });
    expect(by.at90).toMatchObject({ status: "near", remainingCents: 1000, overCents: 0 });
    expect(by.at100).toMatchObject({ status: "near", remainingCents: 0, overCents: 0 });
    expect(by.over1).toMatchObject({ status: "over", remainingCents: 0, overCents: 1 });
  });

  it("nests a subcategory budget under its budgeted parent without adding it to the total", () => {
    const { items, totals } = buildBudgetOverview([
      row({ categoryId: "housing", budgetCents: 100000, spentCents: 90000 }),
      row({ categoryId: "rent", parentId: "housing", parentName: "housing", budgetCents: 80000, spentCents: 80000 }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].children.map((c) => c.categoryId)).toEqual(["rent"]);
    expect(items[0].childrenBudgetCents).toBe(80000);
    expect(items[0].subcategoriesExceedParent).toBe(false);
    expect(totals).toEqual({ budgetedCents: 100000, spentCents: 90000, overCount: 0 });
  });

  it("keeps a subcategory budget standalone when its parent has no budget", () => {
    const { items, totals } = buildBudgetOverview([
      row({ categoryId: "rent", parentId: "housing", parentName: "Housing", budgetCents: 80000, spentCents: 50000 }),
      row({ categoryId: "food", budgetCents: 30000, spentCents: 10000 }),
    ]);
    expect(items.map((i) => i.categoryId).sort()).toEqual(["food", "rent"]);
    const rent = items.find((i) => i.categoryId === "rent");
    expect(rent).toMatchObject({ parentName: "Housing", children: [] });
    expect(totals).toEqual({ budgetedCents: 110000, spentCents: 60000, overCount: 0 });
  });

  it("flags subcategory budgets adding up to more than the parent's", () => {
    const { items } = buildBudgetOverview([
      row({ categoryId: "housing", budgetCents: 40000, spentCents: 0 }),
      row({ categoryId: "rent", parentId: "housing", parentName: "housing", budgetCents: 30000, spentCents: 0 }),
      row({ categoryId: "energy", parentId: "housing", parentName: "housing", budgetCents: 15000, spentCents: 0 }),
    ]);
    expect(items[0]).toMatchObject({ childrenBudgetCents: 45000, subcategoriesExceedParent: true });
  });

  it("does not flag children equal to the parent's budget", () => {
    const { items } = buildBudgetOverview([
      row({ categoryId: "housing", budgetCents: 40000, spentCents: 0 }),
      row({ categoryId: "rent", parentId: "housing", parentName: "housing", budgetCents: 40000, spentCents: 0 }),
    ]);
    expect(items[0].subcategoriesExceedParent).toBe(false);
  });

  it("counts every budgeted category that is over, children included", () => {
    const { totals } = buildBudgetOverview([
      row({ categoryId: "housing", budgetCents: 100, spentCents: 200 }),
      row({ categoryId: "rent", parentId: "housing", parentName: "housing", budgetCents: 50, spentCents: 60 }),
      row({ categoryId: "energy", parentId: "housing", parentName: "housing", budgetCents: 50, spentCents: 10 }),
      row({ categoryId: "food", budgetCents: 100, spentCents: 101 }),
    ]);
    expect(totals.overCount).toBe(3);
    expect(totals).toMatchObject({ budgetedCents: 200, spentCents: 301 });
  });

  it("orders over-budget first, then by share used, then by name; children the same", () => {
    const { items } = buildBudgetOverview([
      row({ categoryId: "b", name: "B", budgetCents: 100, spentCents: 50 }),
      row({ categoryId: "a", name: "A", budgetCents: 100, spentCents: 50 }),
      row({ categoryId: "high", name: "High", budgetCents: 1000, spentCents: 900 }),
      row({ categoryId: "over-small", name: "OverSmall", budgetCents: 100, spentCents: 101 }),
      row({ categoryId: "over-big", name: "OverBig", budgetCents: 100, spentCents: 300 }),
      row({ categoryId: "c1", name: "Child low", parentId: "a", parentName: "A", budgetCents: 100, spentCents: 10 }),
      row({ categoryId: "c2", name: "Child high", parentId: "a", parentName: "A", budgetCents: 100, spentCents: 40 }),
    ]);
    expect(items.map((i) => i.categoryId)).toEqual(["over-big", "over-small", "high", "a", "b"]);
    expect(items.find((i) => i.categoryId === "a")?.children.map((c) => c.categoryId)).toEqual(["c2", "c1"]);
  });

  it("compares shares exactly for very large cents values", () => {
    const { items } = buildBudgetOverview([
      row({ categoryId: "x", name: "X", budgetCents: 999_999_999, spentCents: 999_999_998 }),
      row({ categoryId: "y", name: "Y", budgetCents: 1_000_000_000, spentCents: 999_999_999 }),
    ]);
    // 999999998/999999999 < 999999999/1000000000; the product exceeds 2^53, so this needs BigInt.
    expect(items.map((i) => i.categoryId)).toEqual(["y", "x"]);
  });
});

describe("buildBudgetOverview with rollover and pace", () => {
  it("adds the carry to the budget for status, remaining and totals", () => {
    const { items, totals } = buildBudgetOverview([
      row({ categoryId: "gifts", budgetCents: 5000, spentCents: 12000, carryCents: 10000 }),
      row({ categoryId: "car", budgetCents: 5000, spentCents: 1000, carryCents: -4500 }),
      row({ categoryId: "food", budgetCents: 5000, spentCents: 1000 }),
    ]);
    const by = Object.fromEntries(items.map((i) => [i.categoryId, i]));
    expect(by.gifts).toMatchObject({ availableCents: 15000, remainingCents: 3000, status: "ok", carryCents: 10000 });
    expect(by.car).toMatchObject({ availableCents: 500, overCents: 500, status: "over" });
    expect(by.food).toMatchObject({ availableCents: 5000, carryCents: null });
    expect(totals).toMatchObject({ budgetedCents: 20500, overCount: 1 });
  });

  it("reads as over from day one when overspending ate the whole budget", () => {
    const [item] = buildBudgetOverview([row({ categoryId: "car", budgetCents: 5000, spentCents: 1, carryCents: -6000 })]).items;
    expect(item).toMatchObject({ availableCents: -1000, status: "over", overCents: 1001, remainingCents: 0 });
  });

  it("flags and sorts budgets on pace to go over after the over ones", () => {
    const pace = { day: 10, daysInMonth: 30, billsDueCents: new Map([["bills", 9000]]) };
    const { items } = buildBudgetOverview(
      [
        row({ categoryId: "calm", budgetCents: 10000, spentCents: 3000 }),
        row({ categoryId: "fast", budgetCents: 10000, spentCents: 4000 }),
        row({ categoryId: "bills", budgetCents: 10000, spentCents: 2000 }),
        row({ categoryId: "over", budgetCents: 10000, spentCents: 10001 }),
      ],
      pace,
    );
    expect(items.map((i) => [i.categoryId, i.onPace])).toEqual([
      ["over", false],
      ["fast", true],
      ["bills", true],
      ["calm", false],
    ]);
  });

  it("never flags pace without a pace context", () => {
    const [item] = buildBudgetOverview([row({ categoryId: "fast", budgetCents: 100, spentCents: 99 })]).items;
    expect(item.onPace).toBe(false);
  });
});
