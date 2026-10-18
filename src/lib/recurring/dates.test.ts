import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonthsClamped,
  daysBetween,
  nextExpectedDate,
  occurrencesBetween,
} from "./dates";

describe("daysBetween", () => {
  it("is signed and counts calendar days", () => {
    expect(daysBetween("2025-01-01", "2025-01-31")).toBe(30);
    expect(daysBetween("2025-01-31", "2025-01-01")).toBe(-30);
    expect(daysBetween("2025-05-05", "2025-05-05")).toBe(0);
  });

  it("is not shifted by DST changes", () => {
    expect(daysBetween("2025-03-29", "2025-03-31")).toBe(2);
    expect(daysBetween("2025-10-25", "2025-10-27")).toBe(2);
  });

  it("handles leap years", () => {
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
    expect(daysBetween("2025-02-28", "2025-03-01")).toBe(1);
    expect(daysBetween("2024-01-01", "2025-01-01")).toBe(366);
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2025-12-30", 3)).toBe("2026-01-02");
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });
});

describe("addMonthsClamped", () => {
  it("clamps to the end of a shorter month", () => {
    expect(addMonthsClamped("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsClamped("2025-03-31", 1)).toBe("2025-04-30");
  });

  it("keeps the day when the target month is long enough", () => {
    expect(addMonthsClamped("2025-01-15", 1)).toBe("2025-02-15");
  });

  it("rolls over years", () => {
    expect(addMonthsClamped("2025-11-30", 3)).toBe("2026-02-28");
    expect(addMonthsClamped("2025-12-15", 1)).toBe("2026-01-15");
    expect(addMonthsClamped("2025-01-15", -1)).toBe("2024-12-15");
    expect(addMonthsClamped("2025-01-15", 24)).toBe("2027-01-15");
  });

  it("clamps Feb 29 on non-leap years", () => {
    expect(addMonthsClamped("2024-02-29", 12)).toBe("2025-02-28");
    expect(addMonthsClamped("2024-02-29", 48)).toBe("2028-02-29");
  });
});

describe("nextExpectedDate", () => {
  it("adds one interval", () => {
    expect(nextExpectedDate("2025-01-31", "weekly")).toBe("2025-02-07");
    expect(nextExpectedDate("2025-01-31", "monthly")).toBe("2025-02-28");
    expect(nextExpectedDate("2025-11-30", "quarterly")).toBe("2026-02-28");
    expect(nextExpectedDate("2024-02-29", "yearly")).toBe("2025-02-28");
  });
});

describe("occurrencesBetween", () => {
  it("gives 4 or 5 weekly occurrences depending on the month", () => {
    expect(occurrencesBetween("2025-12-04", "weekly", "2026-01-01", "2026-01-31")).toEqual([
      "2026-01-01",
      "2026-01-08",
      "2026-01-15",
      "2026-01-22",
      "2026-01-29",
    ]);
    expect(occurrencesBetween("2025-12-04", "weekly", "2026-02-01", "2026-02-28")).toEqual([
      "2026-02-05",
      "2026-02-12",
      "2026-02-19",
      "2026-02-26",
    ]);
  });

  it("does not drift from the 31st after a clamped February", () => {
    expect(occurrencesBetween("2025-01-31", "monthly", "2025-02-01", "2025-02-28")).toEqual([
      "2025-02-28",
    ]);
    expect(occurrencesBetween("2025-01-31", "monthly", "2025-03-01", "2025-03-31")).toEqual([
      "2025-03-31",
    ]);
    expect(occurrencesBetween("2024-01-31", "monthly", "2024-02-01", "2024-02-29")).toEqual([
      "2024-02-29",
    ]);
  });

  it("returns every monthly occurrence across a multi-month window", () => {
    expect(occurrencesBetween("2025-01-31", "monthly", "2025-02-01", "2025-04-30")).toEqual([
      "2025-02-28",
      "2025-03-31",
      "2025-04-30",
    ]);
  });

  it("includes quarterly and yearly items only when due in the window", () => {
    expect(occurrencesBetween("2025-10-15", "quarterly", "2026-01-01", "2026-01-31")).toEqual([
      "2026-01-15",
    ]);
    expect(occurrencesBetween("2025-10-15", "quarterly", "2025-11-01", "2025-11-30")).toEqual([]);
    expect(occurrencesBetween("2025-03-10", "yearly", "2026-03-01", "2026-03-31")).toEqual([
      "2026-03-10",
    ]);
    expect(occurrencesBetween("2025-03-10", "yearly", "2026-04-01", "2026-04-30")).toEqual([]);
  });

  it("still projects an item overdue by several intervals into the window", () => {
    expect(occurrencesBetween("2025-01-05", "monthly", "2025-09-01", "2025-09-30")).toEqual([
      "2025-09-05",
    ]);
    expect(occurrencesBetween("2025-01-03", "weekly", "2025-09-01", "2025-09-07")).toEqual([
      "2025-09-05",
    ]);
    expect(occurrencesBetween("2020-02-29", "yearly", "2025-02-01", "2025-02-28")).toEqual([
      "2025-02-28",
    ]);
  });

  it("is strictly after `last`", () => {
    expect(occurrencesBetween("2025-01-05", "monthly", "2025-01-05", "2025-01-31")).toEqual([]);
    expect(occurrencesBetween("2025-01-05", "monthly", "2025-01-05", "2025-02-05")).toEqual([
      "2025-02-05",
    ]);
  });

  it("is empty when the window is before `last` or inverted", () => {
    expect(occurrencesBetween("2025-06-05", "monthly", "2025-01-01", "2025-03-31")).toEqual([]);
    expect(occurrencesBetween("2025-01-05", "monthly", "2025-03-31", "2025-03-01")).toEqual([]);
  });
});
