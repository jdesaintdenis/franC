import { describe, expect, it } from "vitest";

import { presetsFrom } from "./presets";

const spent = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("presetsFrom", () => {
  it("gives last month and the 3-month average, rounded up to the euro", () => {
    expect(presetsFrom(spent({ "2026-01": 10000, "2026-02": 20000, "2026-03": 30001, "2025-12": 99999 }), "2026-04", "2020-01")).toEqual({
      lastMonthCents: 30100,
      averageCents: 20100,
    });
  });

  it("keeps exact euros as they are and wraps the year", () => {
    expect(presetsFrom(spent({ "2025-12": 3000, "2025-11": 0, "2025-10": 6000 }), "2026-01", "2025-01")).toEqual({
      lastMonthCents: 3000,
      averageCents: 3000,
    });
  });

  it("averages over the months with data when history is shorter than 3 months", () => {
    expect(presetsFrom(spent({ "2026-02": 1000, "2026-03": 3000 }), "2026-04", "2026-02")).toEqual({
      lastMonthCents: 3000,
      averageCents: 2000,
    });
  });

  it("is zero without data or without a full month", () => {
    expect(presetsFrom(undefined, "2026-04", null)).toEqual({ lastMonthCents: 0, averageCents: 0 });
    expect(presetsFrom(spent({ "2026-04": 500 }), "2026-04", "2026-04")).toEqual({ lastMonthCents: 0, averageCents: 0 });
  });
});
