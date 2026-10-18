import { describe, expect, it } from "vitest";

import { bestAndWorstMonths, type HighlightMonth } from "./highlights";

function m(month: string, income: number, spent: number, hasData = true): HighlightMonth {
  return { month, incomeCents: income, spentCents: spent, hasData };
}

describe("bestAndWorstMonths", () => {
  it("picks the highest and lowest saved", () => {
    const rows = [m("2026-01", 300000, 250000), m("2026-02", 300000, 200000), m("2026-03", 300000, 375800)];
    expect(bestAndWorstMonths(rows, "2026-10")).toEqual({
      best: { month: "2026-02", savedCents: 100000 },
      worst: { month: "2026-03", savedCents: -75800 },
    });
  });

  it("leaves the current and future months out", () => {
    const rows = [m("2026-01", 100, 50), m("2026-02", 100, 90), m("2026-03", 9999, 0), m("2026-04", 0, 0, false)];
    const result = bestAndWorstMonths(rows, "2026-03");
    expect(result?.best.month).toBe("2026-01");
    expect(result?.worst.month).toBe("2026-02");
  });

  it("ignores months without transactions", () => {
    const rows = [m("2026-01", 100, 50), m("2026-02", 0, 0, false), m("2026-03", 100, 60)];
    expect(bestAndWorstMonths(rows, "2026-10")?.worst.month).toBe("2026-03");
  });

  it("needs at least two finished months", () => {
    expect(bestAndWorstMonths([m("2026-01", 100, 50)], "2026-10")).toBeNull();
    expect(bestAndWorstMonths([m("2026-01", 100, 50), m("2026-02", 100, 50)], "2026-02")).toBeNull();
  });

  it("is null when every month saved the same", () => {
    expect(bestAndWorstMonths([m("2026-01", 100, 50), m("2026-02", 100, 50)], "2026-10")).toBeNull();
  });

  it("ties go to the earliest month", () => {
    const rows = [m("2026-04", 100, 50), m("2026-01", 100, 50), m("2026-02", 100, 10), m("2026-03", 100, 10)];
    const result = bestAndWorstMonths(rows, "2026-10");
    expect(result?.best.month).toBe("2026-02");
    expect(result?.worst.month).toBe("2026-01");
  });

  it("when all months are positive the worst is still the lowest", () => {
    const result = bestAndWorstMonths([m("2026-01", 100, 10), m("2026-02", 100, 80)], "2026-10");
    expect(result?.worst).toEqual({ month: "2026-02", savedCents: 20 });
  });
});
