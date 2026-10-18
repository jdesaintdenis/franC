import { describe, expect, it } from "vitest";

import { monthProgress, perDayCents, showsNextMonth } from "./per-day";

describe("monthProgress", () => {
  it("reads day and month length", () => {
    expect(monthProgress("2025-09-15")).toEqual({ day: 15, daysInMonth: 30 });
    expect(monthProgress("2025-10-01")).toEqual({ day: 1, daysInMonth: 31 });
    expect(monthProgress("2025-02-28")).toEqual({ day: 28, daysInMonth: 28 });
    expect(monthProgress("2024-02-29")).toEqual({ day: 29, daysInMonth: 29 });
  });
});

describe("perDayCents", () => {
  it("divides over the remaining days, today included", () => {
    expect(perDayCents(30000, "2025-09-21")).toEqual({ perDayCents: 3000, daysLeft: 10 });
  });
  it("floors", () => {
    expect(perDayCents(1000, "2025-09-28")).toEqual({ perDayCents: 333, daysLeft: 3 });
    expect(perDayCents(1001, "2025-09-28")).toEqual({ perDayCents: 333, daysLeft: 3 });
  });
  it("last day has one day left", () => {
    expect(perDayCents(5000, "2025-09-30")).toEqual({ perDayCents: 5000, daysLeft: 1 });
    expect(perDayCents(5000, "2025-10-31")).toEqual({ perDayCents: 5000, daysLeft: 1 });
  });
  it("first day of a 31-day month", () => {
    expect(perDayCents(31000, "2025-10-01")).toEqual({ perDayCents: 1000, daysLeft: 31 });
  });
  it("handles February and leap years", () => {
    expect(perDayCents(2800, "2025-02-01")).toEqual({ perDayCents: 100, daysLeft: 28 });
    expect(perDayCents(2900, "2024-02-01")).toEqual({ perDayCents: 100, daysLeft: 29 });
    expect(perDayCents(100, "2025-02-28")?.daysLeft).toBe(1);
    expect(perDayCents(100, "2024-02-28")?.daysLeft).toBe(2);
  });
  it("is null when nothing is left", () => {
    expect(perDayCents(0, "2025-09-10")).toBeNull();
    expect(perDayCents(-500, "2025-09-10")).toBeNull();
  });
});

describe("showsNextMonth", () => {
  it("starts on the 28th", () => {
    expect(showsNextMonth("2025-09-27")).toBe(false);
    expect(showsNextMonth("2025-09-28")).toBe(true);
    expect(showsNextMonth("2025-09-30")).toBe(true);
    expect(showsNextMonth("2025-09-01")).toBe(false);
  });
});
