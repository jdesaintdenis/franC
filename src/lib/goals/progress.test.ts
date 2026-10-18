import { describe, expect, it } from "vitest";

import { compareGoals, goalProgress, type GoalProgressInput } from "./progress";

const car: GoalProgressInput = {
  targetCents: 300_000,
  targetDate: "2027-06-15",
  savedCents: 120_000,
  startCents: 120_000,
  startDate: "2026-09-30",
  today: "2026-09-30",
};

describe("goalProgress", () => {
  it("spreads what's left over the months left, counting this month and the target month", () => {
    const p = goalProgress(car);
    // September to June = 10 months; 1 800 € / 10.
    expect(p.monthsLeft).toBe(10);
    expect(p.monthlyCents).toBe(18_000);
    expect(p.remainingCents).toBe(180_000);
    expect(p.percent).toBe(40);
  });

  it("rounds the monthly amount up to the cent", () => {
    const p = goalProgress({ ...car, targetCents: 100_000, savedCents: 0, startCents: 0, targetDate: "2026-11-01" });
    // 1 000 € over 3 months = 333.333… €
    expect(p.monthlyCents).toBe(33_334);
  });

  it("asks for the whole remainder when the date is this month", () => {
    const p = goalProgress({ ...car, targetDate: "2026-09-30" });
    expect(p.monthsLeft).toBe(1);
    expect(p.monthlyCents).toBe(180_000);
  });

  it("is on track the month the plan starts, before any saving is due", () => {
    expect(goalProgress({ ...car, savedCents: 120_000 }).status).toBe("onTrack");
  });

  it("is behind when saved is below the straight line at the start of this month", () => {
    // Plan: 0 € in Sept 2026 to 1 000 € in Dec 2026 (4 months). At the start of Nov, 2 months
    // are due: 500 €.
    const plan = { targetCents: 100_000, targetDate: "2026-12-31", startCents: 0, startDate: "2026-09-10" };
    const behind = goalProgress({ ...plan, savedCents: 40_000, today: "2026-11-02" });
    expect(behind.status).toBe("behind");
    expect(behind.behindCents).toBe(10_000);
    // Monthly amount is recomputed from what's left: 600 € over Nov and Dec.
    expect(behind.monthlyCents).toBe(30_000);

    const onTrack = goalProgress({ ...plan, savedCents: 50_000, today: "2026-11-02" });
    expect(onTrack.status).toBe("onTrack");
    expect(onTrack.behindCents).toBe(0);
  });

  it("measures from a restarted plan, not from zero", () => {
    // Restarted in Nov with 600 € saved: nothing is due yet in Nov.
    const p = goalProgress({
      targetCents: 100_000,
      targetDate: "2026-12-31",
      savedCents: 60_000,
      startCents: 60_000,
      startDate: "2026-11-05",
      today: "2026-11-20",
    });
    expect(p.status).toBe("onTrack");
  });

  it("is reached at or over the target, with nothing left to save", () => {
    expect(goalProgress({ ...car, savedCents: 300_000 }).status).toBe("reached");
    const over = goalProgress({ ...car, savedCents: 350_000 });
    expect(over.status).toBe("reached");
    expect(over.percent).toBe(100);
    expect(over.remainingCents).toBe(0);
    expect(over.monthlyCents).toBeNull();
  });

  it("is past the target date once its month is over", () => {
    const p = goalProgress({ ...car, today: "2027-07-01" });
    expect(p.status).toBe("pastDue");
    expect(p.monthlyCents).toBeNull();
    expect(p.remainingCents).toBe(180_000);
    // Still within June: one month left, not past.
    expect(goalProgress({ ...car, today: "2027-06-30" }).status).not.toBe("pastDue");
  });

  it("shows progress only without a date", () => {
    const p = goalProgress({ ...car, targetDate: null });
    expect(p.status).toBe("noDate");
    expect(p.monthlyCents).toBeNull();
    expect(p.percent).toBe(40);
  });

  it("counts a negative balance as nothing saved", () => {
    const p = goalProgress({ ...car, savedCents: -5_000 });
    expect(p.savedCents).toBe(0);
    expect(p.percent).toBe(0);
    expect(p.remainingCents).toBe(300_000);
  });
});

describe("compareGoals", () => {
  const goal = (name: string, targetDate: string | null, savedCents: number) => ({
    name,
    targetDate,
    progress: goalProgress({ ...car, targetDate, savedCents, startCents: savedCents, today: "2026-09-30" }),
  });

  it("puts goals needing attention first, then by date, dateless next, reached last", () => {
    const reached = goal("Bike", "2026-10-01", 300_000);
    const noDate = goal("Rainy day", null, 0);
    const late = goal("Sofa", "2027-12-01", 0);
    const soon = goal("Holidays", "2027-01-01", 0);
    const past = goal("Laptop", "2026-08-01", 0);
    const sorted = [reached, noDate, late, soon, past].sort(compareGoals).map((g) => g.name);
    expect(sorted).toEqual(["Laptop", "Holidays", "Sofa", "Rainy day", "Bike"]);
  });
});
