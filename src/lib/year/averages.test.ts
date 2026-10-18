import { describe, expect, it } from "vitest";

import { biggestMonths, buildCategoryMatrix, monthlyAverage, type CategoryMonthInput } from "./averages";
import { monthsOfYear } from "./year";

const months = monthsOfYear(2025);

function row(name: string, month: string, spentCents: number, categoryId: string | null = name): CategoryMonthInput {
  return { categoryId, name, color: "#111111", icon: null, month, spentCents };
}

describe("monthlyAverage", () => {
  it("is 0 without months", () => {
    expect(monthlyAverage(1000, 0)).toBe(0);
  });
  it("rounds half away from zero", () => {
    expect(monthlyAverage(5, 2)).toBe(3);
    expect(monthlyAverage(-5, 2)).toBe(-3);
    expect(monthlyAverage(4, 3)).toBe(1);
    expect(monthlyAverage(-4, 3)).toBe(-1);
    expect(monthlyAverage(1, 3)).toBe(0);
    expect(monthlyAverage(12000, 12)).toBe(1000);
  });
  it("stays exact for big values", () => {
    expect(monthlyAverage(9_007_199_254_740_990, 2)).toBe(4_503_599_627_370_495);
  });
});

describe("biggestMonths", () => {
  it("returns the top n non-zero indexes, earlier first on ties", () => {
    expect(biggestMonths([0, 5, 5, 5, 1, 0], 2)).toEqual([1, 2]);
    expect(biggestMonths([1, 9, 3, 7, 0], 3)).toEqual([1, 2, 3]);
  });
  it("skips zeros", () => {
    expect(biggestMonths([0, 0, 4], 3)).toEqual([2]);
  });
});

describe("buildCategoryMatrix", () => {
  it("zero-fills, totals, averages and sorts", () => {
    const covered = months.slice(0, 4);
    const m = buildCategoryMatrix(
      [row("B", "2025-01", 100), row("A", "2025-02", 300), row("A", "2025-04", 300), row("B", "2025-04", 200)],
      months,
      covered,
    );
    expect(m.rows.map((r) => r.name)).toEqual(["A", "B"]);
    expect(m.rows[0].byMonth).toEqual([0, 300, 0, 300, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(m.rows[0].totalCents).toBe(600);
    expect(m.rows[0].averageCents).toBe(150);
    expect(m.rows[0].biggestMonthIndexes).toEqual([1, 3]);
    expect(m.totals.byMonth.slice(0, 4)).toEqual([100, 300, 0, 500]);
    expect(m.totals.totalCents).toBe(900);
    expect(m.totals.averageCents).toBe(225);
  });

  it("breaks ties on total by name", () => {
    const m = buildCategoryMatrix([row("Z", "2025-01", 100), row("A", "2025-01", 100)], months, months);
    expect(m.rows.map((r) => r.name)).toEqual(["A", "Z"]);
  });

  it("highlights a row's peak only with spending in 2+ months", () => {
    const m = buildCategoryMatrix([row("Once", "2025-05", 900), row("Twice", "2025-01", 10), row("Twice", "2025-02", 20)], months, months);
    expect(m.rows.find((r) => r.name === "Once")?.biggestMonthIndexes).toEqual([]);
    expect(m.rows.find((r) => r.name === "Twice")?.biggestMonthIndexes).toEqual([1]);
  });

  it("highlights the 3 biggest months in the totals", () => {
    const m = buildCategoryMatrix(
      [row("A", "2025-01", 10), row("A", "2025-02", 50), row("A", "2025-03", 40), row("A", "2025-04", 30), row("A", "2025-05", 20)],
      months,
      months,
    );
    expect(m.totals.biggestMonthIndexes).toEqual([1, 2, 3]);
  });

  it("keeps uncategorized as its own row and handles empty input", () => {
    const m = buildCategoryMatrix([row("Uncategorized", "2025-01", 5, null)], months, months);
    expect(m.rows[0].categoryId).toBeNull();
    const empty = buildCategoryMatrix([], months, []);
    expect(empty.rows).toEqual([]);
    expect(empty.totals.averageCents).toBe(0);
    expect(empty.totals.biggestMonthIndexes).toEqual([]);
  });
});
