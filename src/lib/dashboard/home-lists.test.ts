// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { BudgetItem, BudgetOverview } from "../budgets/progress";
import { budgetDetail, budgetPercent, gaugeBlocks, gaugeSegments, homeBudgets, paceTickPercent, restPaceTickPercent } from "./home-lists";

const item = (name: string): BudgetItem => ({ name }) as BudgetItem;

describe("homeBudgets", () => {
  it("keeps the overview's order and cuts at 4", () => {
    const overview = { items: ["a", "b", "c", "d", "e"].map(item), totals: {} } as unknown as BudgetOverview;
    const { shown, total } = homeBudgets(overview);
    expect(shown.map((i) => i.name)).toEqual(["a", "b", "c", "d"]);
    expect(total).toBe(5);
  });
});

describe("budgetPercent", () => {
  it("floors and does not cap", () => {
    expect(budgetPercent({ spentCents: 0, availableCents: 100 })).toBe(0);
    expect(budgetPercent({ spentCents: 69, availableCents: 100 })).toBe(69);
    expect(budgetPercent({ spentCents: 1, availableCents: 3 })).toBe(33);
    expect(budgetPercent({ spentCents: 140, availableCents: 100 })).toBe(140);
  });
  it("is 100 when nothing is available", () => {
    expect(budgetPercent({ spentCents: 50, availableCents: 0 })).toBe(100);
  });
});

describe("gaugeBlocks", () => {
  it("fills one block per 10 % and a half block from 5", () => {
    expect(gaugeBlocks(0)).toEqual({ full: 0, half: false });
    expect(gaugeBlocks(4)).toEqual({ full: 0, half: false });
    expect(gaugeBlocks(5)).toEqual({ full: 0, half: true });
    expect(gaugeBlocks(69)).toEqual({ full: 6, half: true });
    expect(gaugeBlocks(100)).toEqual({ full: 10, half: false });
    expect(gaugeBlocks(140)).toEqual({ full: 10, half: false });
  });
});

describe("paceTickPercent", () => {
  it("is the share of the month elapsed", () => {
    expect(paceTickPercent(5, 31)).toBe(16);
    expect(paceTickPercent(31, 31)).toBe(100);
  });
});

describe("budgetDetail", () => {
  it("is x sur y without carry", () => {
    expect(budgetDetail({ spentCents: 500, availableCents: 1000, carryCents: null })).toEqual({
      kind: "of",
      spentCents: 500,
      availableCents: 1000,
    });
  });

  it("stays x sur y with a positive carry", () => {
    expect(budgetDetail({ spentCents: 500, availableCents: 1500, carryCents: 500 }).kind).toBe("of");
  });

  it("tells a deficit that leaves some room as a delay carried", () => {
    expect(budgetDetail({ spentCents: 500, availableCents: 700, carryCents: -300 })).toEqual({
      kind: "ofBehind",
      spentCents: 500,
      availableCents: 700,
      carryCents: 300,
    });
  });

  it("tells a deficit that leaves nothing without a negative sur", () => {
    expect(budgetDetail({ spentCents: 500, availableCents: -3340, carryCents: -4000 })).toEqual({
      kind: "behind",
      spentCents: 500,
      carryCents: 4000,
    });
    expect(budgetDetail({ spentCents: 0, availableCents: 0, carryCents: -1000 }).kind).toBe("behind");
  });
});

describe("homeBudgets and payments-only budgets", () => {
  it("leaves out a budget its regular payments fill", () => {
    const rent = { name: "rent", availableCents: 10700, status: "ok", charges: [{ amountCents: 10700, paid: false }] } as unknown as BudgetItem;
    const overview = { items: [rent, item("a")], totals: {} } as unknown as BudgetOverview;
    const { shown, total } = homeBudgets(overview);
    expect(shown.map((i) => i.name)).toEqual(["a"]);
    expect(total).toBe(1);
  });
});

describe("gaugeSegments", () => {
  it("puts paid payments first, other spending next, payments due last", () => {
    // 200 € budget, 22,40 € spent, 150 € gym due.
    expect(gaugeSegments({ availableCents: 20000, spentCents: 2240 }, { paidCents: 0, dueCents: 15000 })).toEqual([
      { kind: "other", percent: 11.2 },
      { kind: "due", percent: 75 },
    ]);
    // Rent paid 750 + EDF due 78,20 in 1 000 €.
    const rent = gaugeSegments({ availableCents: 100000, spentCents: 75000 }, { paidCents: 75000, dueCents: 7820 });
    expect(rent.map((s) => s.kind)).toEqual(["paid", "due"]);
    expect(rent[1].percent).toBeCloseTo(7.82);
  });
  it("caps at 100 % and fills with spending when nothing is available", () => {
    const segments = gaugeSegments({ availableCents: 10000, spentCents: 9000 }, { paidCents: 0, dueCents: 5000 });
    expect(segments.reduce((sum, s) => sum + s.percent, 0)).toBe(100);
    expect(gaugeSegments({ availableCents: 0, spentCents: 500 }, { paidCents: 0, dueCents: 0 })).toEqual([{ kind: "other", percent: 100 }]);
  });
});

describe("restPaceTickPercent", () => {
  it("equals the plain pace without payments", () => {
    expect(restPaceTickPercent(13, 31, { availableCents: 20000 }, { paidCents: 0, dueCents: 0 })).toBe(paceTickPercent(13, 31));
  });
  it("starts after paid payments and leaves room for the ones due", () => {
    // 150 € due of 200 €: only the 25 % left is paced: 13/31 of it.
    expect(restPaceTickPercent(13, 31, { availableCents: 20000 }, { paidCents: 0, dueCents: 15000 })).toBe(10);
    // 100 € paid of 200 €: starts at 50 %.
    expect(restPaceTickPercent(31, 31, { availableCents: 20000 }, { paidCents: 10000, dueCents: 0 })).toBe(100);
    expect(restPaceTickPercent(1, 31, { availableCents: 20000 }, { paidCents: 10000, dueCents: 0 })).toBe(52);
  });
  it("falls back to the plain pace when nothing is available", () => {
    expect(restPaceTickPercent(10, 30, { availableCents: 0 }, { paidCents: 100, dueCents: 0 })).toBe(33);
  });
});
