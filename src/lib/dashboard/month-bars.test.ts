import { describe, expect, it } from "vitest";

import { monthBarScale, monthBarWindow } from "./month-bars";

const spent = new Map([
  ["2026-10", 132700],
  ["2026-07", 418600],
]);

describe("monthBarWindow", () => {
  it("shows nine months plus the next one when the current month is selected", () => {
    const bars = monthBarWindow({ selected: "2026-10", current: "2026-10", spentByMonth: spent, nextPlannedCents: 384400 });
    expect(bars).toHaveLength(10);
    expect(bars[0].month).toBe("2026-02");
    expect(bars[8]).toMatchObject({ month: "2026-10", kind: "current", selected: true, spentCents: 132700 });
    expect(bars[9]).toMatchObject({ month: "2026-11", kind: "next", spentCents: 384400 });
  });

  it("keeps the same window when the selected month is three months back", () => {
    const bars = monthBarWindow({ selected: "2026-07", current: "2026-10", spentByMonth: spent, nextPlannedCents: 0 });
    expect(bars.map((b) => b.month)[0]).toBe("2026-02");
    expect(bars.filter((b) => b.selected).map((b) => b.month)).toEqual(["2026-07"]);
    expect(bars.find((b) => b.month === "2026-07")?.spentCents).toBe(418600);
  });

  it("ends four months after a month picked far back, with no next bar", () => {
    const bars = monthBarWindow({ selected: "2025-08", current: "2026-10", spentByMonth: spent, nextPlannedCents: 1 });
    expect(bars).toHaveLength(9);
    expect(bars[8].month).toBe("2025-12");
    expect(bars.some((b) => b.kind !== "past")).toBe(false);
  });

  it("gives 0 to a month missing from the map", () => {
    const bars = monthBarWindow({ selected: "2026-10", current: "2026-10", spentByMonth: new Map(), nextPlannedCents: 0 });
    expect(bars.every((b) => b.spentCents === 0)).toBe(true);
  });
});

describe("monthBarScale", () => {
  const bars = monthBarWindow({ selected: "2026-10", current: "2026-10", spentByMonth: spent, nextPlannedCents: 0 });

  it("includes the planned amount", () => {
    expect(monthBarScale(bars, 1000000)).toBe(1100000);
  });

  it("follows the tallest bar when it exceeds the plan", () => {
    expect(monthBarScale(bars, 100)).toBe(Math.round(418600 * 1.1));
  });

  it("is at least 1", () => {
    expect(monthBarScale([], 0)).toBe(1);
  });
});
