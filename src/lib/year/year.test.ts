import { describe, expect, it } from "vitest";

import { isFutureMonth, monthsCovered, monthsOfYear, parseYearParam, yearRange } from "./year";

describe("parseYearParam", () => {
  it("accepts 4-digit years in range", () => {
    expect(parseYearParam("2025", 2030)).toBe(2025);
    expect(parseYearParam("2000", 1)).toBe(2000);
    expect(parseYearParam("2100", 1)).toBe(2100);
  });
  it("falls back otherwise", () => {
    for (const v of [undefined, "", "25", "1999", "2101", "20250", "abc", "2025.5", ["2025"]]) {
      expect(parseYearParam(v, 2026)).toBe(2026);
    }
  });
});

describe("months and range", () => {
  it("lists 12 months", () => {
    const m = monthsOfYear(2025);
    expect(m).toHaveLength(12);
    expect(m[0]).toBe("2025-01");
    expect(m[11]).toBe("2025-12");
  });
  it("gives inclusive bounds", () => {
    expect(yearRange(2024)).toEqual({ from: "2024-01-01", to: "2024-12-31" });
  });
  it("detects future months", () => {
    expect(isFutureMonth("2026-10", "2026-09")).toBe(true);
    expect(isFutureMonth("2026-09", "2026-09")).toBe(false);
  });
});

describe("monthsCovered", () => {
  it("covers the whole past year", () => {
    expect(monthsCovered(2025, "2025-01", "2026-09")).toHaveLength(12);
  });
  it("stops at the current month in the current year", () => {
    const m = monthsCovered(2026, "2026-01", "2026-09");
    expect(m).toHaveLength(9);
    expect(m[8]).toBe("2026-09");
  });
  it("starts at the first month with data", () => {
    const m = monthsCovered(2025, "2025-03", "2026-09");
    expect(m).toHaveLength(10);
    expect(m[0]).toBe("2025-03");
  });
  it("is empty without data or for a future year", () => {
    expect(monthsCovered(2025, null, "2026-09")).toEqual([]);
    expect(monthsCovered(2027, "2027-01", "2026-09")).toEqual([]);
  });
});
