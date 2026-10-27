import { describe, expect, it } from "vitest";

import type { CategorySpending } from "@/db/queries/dashboard";

import { budgetSharePercent, changeRatio, changeTone, compareCategories, compareHref, monthNames, parseCompareParams } from "./months";

const cat = (categoryId: string | null, name: string | null, spentCents: number, color = "#111111"): CategorySpending => ({
  categoryId,
  name,
  color,
  icon: null,
  spentCents,
  hasSubcategorySpending: false,
});

describe("parseCompareParams", () => {
  const current = "2026-10";

  it("defaults to the current month against the month before", () => {
    expect(parseCompareParams({}, current)).toEqual({ a: "2026-10", b: "2026-09" });
  });

  it("defaults b to the month before a, across a year", () => {
    expect(parseCompareParams({ a: "2026-01" }, current)).toEqual({ a: "2026-01", b: "2025-12" });
  });

  it("falls back on invalid values and arrays", () => {
    expect(parseCompareParams({ a: "2026-13", b: "nope" }, current)).toEqual({ a: "2026-10", b: "2026-09" });
    expect(parseCompareParams({ a: ["2026-03", "2026-04"], b: "2026-05" }, current)).toEqual({ a: "2026-10", b: "2026-05" });
  });

  it("never compares a month with itself", () => {
    expect(parseCompareParams({ a: "2026-07", b: "2026-07" }, current)).toEqual({ a: "2026-07", b: "2026-06" });
  });

  it("pulls future months back to the current month", () => {
    expect(parseCompareParams({ a: "2099-01", b: "2026-07" }, current)).toEqual({ a: "2026-10", b: "2026-07" });
    expect(parseCompareParams({ a: "2026-08", b: "2027-02" }, current)).toEqual({ a: "2026-08", b: "2026-10" });
    expect(parseCompareParams({ a: "2026-10", b: "2027-02" }, current)).toEqual({ a: "2026-10", b: "2026-09" });
  });

  it("round-trips through compareHref", () => {
    const href = compareHref({ a: "2026-09", b: "2025-07" });
    expect(href).toBe("/budget/compare?a=2026-09&b=2025-07");
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseCompareParams(params, current)).toEqual({ a: "2026-09", b: "2025-07" });
  });
});

describe("compareCategories", () => {
  it("merges both months, missing side at zero, biggest change first", () => {
    const rows = compareCategories(
      [cat("food", "Food", 69000, "#aaaaaa"), cat("fun", "Fun", 19000), cat(null, null, 5000)],
      [cat("food", "Food (old)", 74800, "#bbbbbb"), cat("fun", "Fun", 42000), cat("car", "Car", 39000), cat(null, null, 5000)],
    );
    expect(rows.map((r) => [r.key, r.aCents, r.bCents, r.diffCents])).toEqual([
      ["car", 0, 39000, -39000],
      ["fun", 19000, 42000, -23000],
      ["food", 69000, 74800, -5800],
      ["none", 5000, 5000, 0],
    ]);
    // Name and colour come from the month being looked at.
    expect(rows[2]).toMatchObject({ name: "Food", color: "#aaaaaa" });
  });

  it("breaks ties by spending in A, then by name with uncategorized last", () => {
    const rows = compareCategories([cat("b", "Bravo", 3000), cat("a", "Alpha", 1000), cat(null, null, 1000), cat("c", "Charlie", 1000)], []);
    expect(rows.map((r) => r.key)).toEqual(["b", "a", "c", "none"]);
  });
});

describe("changeRatio", () => {
  it("is null without a base or without a change", () => {
    expect(changeRatio(5000, 0)).toBeNull();
    expect(changeRatio(5000, 5000)).toBeNull();
  });

  it("is the relative change", () => {
    expect(changeRatio(239000, 282800)).toBeCloseTo(-0.1549, 4);
    expect(changeRatio(3000, 2000)).toBe(0.5);
  });
});

describe("changeTone", () => {
  it("treats less spending as good", () => {
    expect(changeTone(-100, false)).toBe("positive");
    expect(changeTone(100, false)).toBe("warning");
    expect(changeTone(0, false)).toBe("same");
  });

  it("treats more income or net as good", () => {
    expect(changeTone(100, true)).toBe("positive");
    expect(changeTone(-100, true)).toBe("warning");
    expect(changeTone(0, true)).toBe("same");
  });
});

describe("budgetSharePercent", () => {
  it("rounds half up and skips empty budgets", () => {
    expect(budgetSharePercent(69000, 70000)).toBe(99);
    expect(budgetSharePercent(42000, 25000)).toBe(168);
    expect(budgetSharePercent(125, 1000)).toBe(13);
    expect(budgetSharePercent(5000, 0)).toBeNull();
  });
});

describe("monthNames", () => {
  it("leaves the year out within one year", () => {
    expect(monthNames({ a: "2026-09", b: "2026-07" }, "fr")).toEqual({
      a: { sentence: "septembre", header: "sept." },
      b: { sentence: "juillet", header: "juil." },
    });
  });

  it("spells the year out across years", () => {
    expect(monthNames({ a: "2026-01", b: "2025-12" }, "en")).toEqual({
      a: { sentence: "January 2026", header: "Jan 2026" },
      b: { sentence: "December 2025", header: "Dec 2025" },
    });
  });
});
