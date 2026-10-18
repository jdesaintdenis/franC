import { describe, expect, it } from "vitest";

import { goalProgress } from "./progress";
import { goalsSummary } from "./summary";

const goal = (targetCents: number, savedCents: number, targetDate: string | null) => ({
  targetCents,
  progress: goalProgress({ targetCents, targetDate, savedCents, startCents: 0, startDate: "2026-06-01", today: "2026-10-07" }),
});

describe("goalsSummary", () => {
  it("is empty without goals", () => {
    expect(goalsSummary([])).toEqual({ savedCents: 0, targetCents: 0, percent: 0, monthlyCents: 0 });
  });

  it("adds saved and target, floors the percentage and caps it at 100", () => {
    const s = goalsSummary([goal(250_000, 40_000, null), goal(90_000, 10_000, null)]);
    expect(s).toMatchObject({ savedCents: 50_000, targetCents: 340_000, percent: 14, monthlyCents: 0 });
    expect(goalsSummary([goal(10_000, 10_000, null)]).percent).toBe(100);
  });

  it("sums the monthly amount of running dated goals only", () => {
    const dated = goal(250_000, 40_000, "2027-06-30");
    const reached = goal(10_000, 10_000, "2027-06-30");
    expect(dated.progress.monthlyCents).toBeGreaterThan(0);
    expect(goalsSummary([dated, reached, goal(50_000, 0, null)]).monthlyCents).toBe(dated.progress.monthlyCents);
  });
});
