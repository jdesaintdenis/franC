// @vitest-environment node
import { describe, expect, it } from "vitest";

import { chargeTotals, chargesByEntry, chargesPresetCents, isChargesOnly, leftToSpend } from "./charges";

const parentOf = new Map<string, string | null>([
  ["sport", null],
  ["gym", "sport"],
  ["food", null],
]);

describe("chargesByEntry", () => {
  const out = chargesByEntry({
    categoryIds: ["sport", "gym", "food"],
    paid: [
      { recurringId: "r1", date: "2026-10-03", amountCents: 1349, categoryId: "gym" },
      { recurringId: "r9", date: "2026-10-04", amountCents: 500, categoryId: "other" },
    ],
    due: [
      { id: "r2", name: "Salle", date: "2026-10-20", amountCents: -15000, categoryId: "sport" },
      { id: "r3", name: "Sans", date: "2026-10-21", amountCents: -900, categoryId: null },
    ],
    names: new Map([["r1", "Netflix"]]),
    parentOf,
  });

  it("rolls a subcategory's charge up into its parent and keeps it in its own budget", () => {
    expect(out.get("gym")?.map((c) => c.name)).toEqual(["Netflix"]);
    expect(out.get("sport")?.map((c) => c.name)).toEqual(["Netflix", "Salle"]);
  });
  it("ignores other and missing categories, orders by date, marks paid vs due", () => {
    expect(out.get("food")).toEqual([]);
    expect(out.get("sport")?.map((c) => [c.paid, c.amountCents])).toEqual([
      [true, 1349],
      [false, 15000],
    ]);
  });
});

describe("chargeTotals", () => {
  it("splits paid and due", () => {
    expect(chargeTotals([{ amountCents: 100, paid: true }, { amountCents: 50, paid: false }, { amountCents: 25, paid: false }])).toEqual({
      paidCents: 100,
      dueCents: 75,
    });
  });
});

describe("isChargesOnly", () => {
  const t = (paidCents: number, dueCents: number) => ({ paidCents, dueCents });
  it("needs the payments to cover at least 95 % of the budget", () => {
    expect(isChargesOnly({ availableCents: 20000, status: "ok" }, t(0, 15000))).toBe(false);
    expect(isChargesOnly({ availableCents: 12400, status: "ok" }, t(12399, 0))).toBe(true);
    expect(isChargesOnly({ availableCents: 10000, status: "ok" }, t(9500, 0))).toBe(true);
    expect(isChargesOnly({ availableCents: 10000, status: "ok" }, t(9499, 0))).toBe(false);
    expect(isChargesOnly({ availableCents: 10700, status: "ok" }, t(0, 10700))).toBe(true);
    expect(isChargesOnly({ availableCents: 10700, status: "ok" }, t(5000, 5700))).toBe(true);
  });
  it("never hides an over or empty budget", () => {
    expect(isChargesOnly({ availableCents: 10700, status: "over" }, t(10700, 0))).toBe(false);
    expect(isChargesOnly({ availableCents: 0, status: "ok" }, t(0, 0))).toBe(false);
  });
});

describe("leftToSpend", () => {
  it("is the budget minus spending and payments due", () => {
    expect(leftToSpend({ availableCents: 20000, spentCents: 2240 }, { paidCents: 0, dueCents: 15000 })).toBe(2760);
    expect(leftToSpend({ availableCents: 20000, spentCents: 2240 }, { paidCents: 0, dueCents: 17760 })).toBe(0);
    expect(leftToSpend({ availableCents: 20000, spentCents: 10000 }, { paidCents: 0, dueCents: 15000 })).toBe(-5000);
  });
});

describe("chargesPresetCents", () => {
  const entries = [
    { name: "Salle", date: "2026-10-20", amountCents: -14950, categoryId: "sport", status: "confirmed" as const },
    { name: "Yoga", date: "2026-10-05", amountCents: -2000, categoryId: "gym", status: "detected" as const },
    { name: "Vieux", date: "2026-10-06", amountCents: -999, categoryId: "sport", status: "ended" as const },
    { name: "Salaire", date: "2026-10-01", amountCents: 200000, categoryId: "sport", status: "confirmed" as const },
    { name: "Autre", date: "2026-10-07", amountCents: -999, categoryId: "food", status: "confirmed" as const },
  ];
  it("sums active outflows of the category and its subcategories, rounded up to the euro", () => {
    expect(chargesPresetCents(entries, "sport", parentOf)).toEqual({
      cents: 17000,
      names: [
        { name: "Salle", day: 20 },
        { name: "Yoga", day: 5 },
      ],
    });
  });
  it("is zero with no payment", () => {
    expect(chargesPresetCents(entries, "unknown", parentOf).cents).toBe(0);
  });
});
