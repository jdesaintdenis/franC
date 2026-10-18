import { describe, expect, it } from "vitest";

import {
  buildPickerYear,
  latestMonthWithData,
  pickerYearBounds,
  trendFromHistory,
  type MonthHistoryRow,
} from "./month-picker";

const row = (month: string, spentCents: number, count = 1, incomeCents = 0): MonthHistoryRow => ({
  month,
  spentCents,
  incomeCents,
  count,
});

const history = [row("2024-11", 500, 3, 100), row("2025-03", 1200), row("2025-05", 0, 0), row("2025-09", 900)];

describe("buildPickerYear", () => {
  it("returns 12 cells with data, empty and future states", () => {
    const cells = buildPickerYear(2025, history, "2025-09");
    expect(cells).toHaveLength(12);
    expect(cells[0]).toEqual({ month: "2025-01", spentCents: 0, state: "empty" });
    expect(cells[2]).toEqual({ month: "2025-03", spentCents: 1200, state: "data" });
    expect(cells[4].state).toBe("empty"); // row with count 0
    expect(cells[8]).toEqual({ month: "2025-09", spentCents: 900, state: "data" });
    expect(cells[9].state).toBe("future");
    expect(cells[11].state).toBe("future");
  });

  it("keeps the current month enabled without rows", () => {
    expect(buildPickerYear(2025, [], "2025-09")[8]).toEqual({ month: "2025-09", spentCents: 0, state: "data" });
  });

  it("marks a whole future year as future and a year without data as empty", () => {
    expect(buildPickerYear(2026, history, "2025-09").every((c) => c.state === "future")).toBe(true);
    expect(buildPickerYear(2023, history, "2025-09").every((c) => c.state === "empty")).toBe(true);
  });
});

describe("pickerYearBounds", () => {
  it("spans the first year with data to the current year", () => {
    expect(pickerYearBounds(history, "2025-09")).toEqual({ minYear: 2024, maxYear: 2025 });
  });
  it("falls back to the current year", () => {
    expect(pickerYearBounds([], "2025-09")).toEqual({ minYear: 2025, maxYear: 2025 });
    expect(pickerYearBounds([row("2025-01", 0, 0)], "2025-09")).toEqual({ minYear: 2025, maxYear: 2025 });
  });
  it("never has maxYear below minYear", () => {
    expect(pickerYearBounds([row("2027-01", 10)], "2025-09")).toEqual({ minYear: 2025, maxYear: 2025 });
  });
});

describe("latestMonthWithData", () => {
  it("ignores empty rows", () => {
    expect(latestMonthWithData([...history, row("2025-11", 0, 0)])).toBe("2025-09");
    expect(latestMonthWithData([])).toBeNull();
  });
});

describe("trendFromHistory", () => {
  it("zero-fills the requested months", () => {
    expect(trendFromHistory(history, ["2025-02", "2025-03"])).toEqual([
      { month: "2025-02", spentCents: 0, incomeCents: 0 },
      { month: "2025-03", spentCents: 1200, incomeCents: 0 },
    ]);
  });
});
