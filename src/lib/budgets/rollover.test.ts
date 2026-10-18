import { describe, expect, it } from "vitest";

import { computeCarry, rollUpMonthlySpending } from "./rollover";

const spent = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("computeCarry", () => {
  const setting = { amountCents: 5000, startMonth: "2025-11", baseCents: 0 };

  it("is null before the start and the base in the start month", () => {
    expect(computeCarry(setting, undefined, "2025-10")).toBeNull();
    expect(computeCarry({ ...setting, baseCents: 700 }, undefined, "2025-11")).toBe(700);
  });

  it("adds leftovers across months and a year boundary, counting empty months as unspent", () => {
    expect(computeCarry(setting, spent({ "2025-11": 1000, "2026-01": 2000 }), "2026-02")).toBe(4000 + 5000 + 3000);
  });

  it("lets overspending take away until the carry is negative", () => {
    expect(computeCarry(setting, spent({ "2025-11": 9000, "2025-12": 8000 }), "2026-01")).toBe(-7000);
    expect(computeCarry({ ...setting, baseCents: -1000 }, spent({ "2025-11": 5000 }), "2025-12")).toBe(-1000);
  });

  it("ignores spending of the month itself", () => {
    expect(computeCarry(setting, spent({ "2025-12": 99999 }), "2025-12")).toBe(5000);
  });
});

describe("rollUpMonthlySpending", () => {
  it("adds subcategory spending to the parent and keeps the child's own", () => {
    const result = rollUpMonthlySpending(
      [
        { categoryId: "food", month: "2026-01", spentCents: 100 },
        { categoryId: "veg", month: "2026-01", spentCents: 20 },
        { categoryId: "veg", month: "2026-02", spentCents: 3 },
      ],
      new Map([
        ["food", null],
        ["veg", "food"],
      ]),
    );
    expect(result.get("food")).toEqual(spent({ "2026-01": 120, "2026-02": 3 }));
    expect(result.get("veg")).toEqual(spent({ "2026-01": 20, "2026-02": 3 }));
  });
});
