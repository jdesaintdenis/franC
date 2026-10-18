// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildPaceSeries } from "./pace-series";

describe("buildPaceSeries", () => {
  it("is flat at zero for an empty month", () => {
    const s = buildPaceSeries({ daily: [], today: "2026-10-03", safeCents: 90000 });
    expect(s.spent).toEqual([
      { day: 1, spentCents: 0 },
      { day: 2, spentCents: 0 },
      { day: 3, spentCents: 0 },
    ]);
    expect(s.daysInMonth).toBe(31);
    expect(s.today).toBe(3);
    expect(s.plannedTotalCents).toBe(90000);
  });

  it("accumulates and repeats the total on days without spending", () => {
    const s = buildPaceSeries({
      daily: [
        { date: "2026-10-01", spentCents: 1000 },
        { date: "2026-10-03", spentCents: 500 },
      ],
      today: "2026-10-04",
      safeCents: 2000,
    });
    expect(s.spent.map((p) => p.spentCents)).toEqual([1000, 1000, 1500, 1500]);
    expect(s.plannedTotalCents).toBe(3500);
  });

  it("ignores rows after today and outside the month", () => {
    const s = buildPaceSeries({
      daily: [
        { date: "2026-10-05", spentCents: 999 },
        { date: "2026-09-30", spentCents: 888 },
        { date: "2026-10-02", spentCents: 100 },
      ],
      today: "2026-10-02",
      safeCents: 0,
    });
    expect(s.spent.map((p) => p.spentCents)).toEqual([0, 100]);
  });

  it("plans no more than spent when nothing is left", () => {
    const s = buildPaceSeries({ daily: [{ date: "2026-10-01", spentCents: 700 }], today: "2026-10-01", safeCents: -500 });
    expect(s.plannedTotalCents).toBe(700);
  });

  it("handles day 1", () => {
    const s = buildPaceSeries({ daily: [], today: "2026-02-01", safeCents: 100 });
    expect(s.spent).toEqual([{ day: 1, spentCents: 0 }]);
    expect(s.daysInMonth).toBe(28);
  });
});
