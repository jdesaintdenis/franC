import { describe, expect, it } from "vitest";

import { clampSyncFrom, defaultSyncFrom, earliestSyncFrom, fetchFrom, sharedSyncFrom } from "./window";

describe("earliestSyncFrom", () => {
  it("is today - 89 days", () => {
    expect(earliestSyncFrom("2025-10-01")).toBe("2025-07-04");
    expect(earliestSyncFrom("2026-01-15")).toBe("2025-10-18");
  });
  it("crosses a leap day", () => {
    expect(earliestSyncFrom("2024-05-01")).toBe("2024-02-02");
    expect(earliestSyncFrom("2024-03-01")).toBe("2023-12-03");
  });
});

describe("clampSyncFrom", () => {
  it("clamps both ways", () => {
    expect(clampSyncFrom("2025-10-01", "2025-01-01")).toBe("2025-07-04");
    expect(clampSyncFrom("2025-10-01", "2025-12-01")).toBe("2025-10-01");
    expect(clampSyncFrom("2025-10-01", "2025-09-01")).toBe("2025-09-01");
  });
});

describe("defaultSyncFrom", () => {
  it("is the day after the newest transaction", () => {
    expect(defaultSyncFrom("2025-10-01", "2025-09-30")).toBe("2025-10-01");
    expect(defaultSyncFrom("2025-10-01", "2025-08-31")).toBe("2025-09-01");
    expect(defaultSyncFrom("2025-01-05", "2024-12-31")).toBe("2025-01-01");
  });
  it("clamps a stale or future newest date", () => {
    expect(defaultSyncFrom("2025-10-01", "2024-01-01")).toBe("2025-07-04");
    expect(defaultSyncFrom("2025-10-01", "2025-10-01")).toBe("2025-10-01");
    expect(defaultSyncFrom("2025-10-01", "2025-11-01")).toBe("2025-10-01");
  });
  it("starts an empty account at the earliest date", () => {
    expect(defaultSyncFrom("2025-10-01", null)).toBe("2025-07-04");
  });
  it("handles a leap day", () => {
    expect(defaultSyncFrom("2024-03-10", "2024-02-28")).toBe("2024-02-29");
  });
});

describe("fetchFrom", () => {
  const today = "2025-10-01";
  it("first sync goes back 4 days from the start date", () => {
    expect(fetchFrom({ today, syncFrom: "2025-09-20", lastSyncedOn: null })).toBe("2025-09-16");
    expect(fetchFrom({ today: "2025-01-10", syncFrom: "2025-01-02", lastSyncedOn: null })).toBe("2024-12-29");
  });
  it("never goes before the history window", () => {
    expect(fetchFrom({ today, syncFrom: "2025-07-04", lastSyncedOn: null })).toBe("2025-07-04");
  });
  it("later sync re-reads the last week, then the overlap", () => {
    expect(fetchFrom({ today, syncFrom: "2025-09-01", lastSyncedOn: "2025-09-28" })).toBe("2025-09-17");
  });
  it("later sync with a more recent start date uses it", () => {
    expect(fetchFrom({ today, syncFrom: "2025-09-29", lastSyncedOn: "2025-09-10" })).toBe("2025-09-25");
  });
  it("a far-past lastSyncedOn is clamped to the window", () => {
    expect(fetchFrom({ today, syncFrom: "2025-07-04", lastSyncedOn: "2025-01-01" })).toBe("2025-07-04");
  });
  it("syncFrom = today asks for the last 4 days", () => {
    expect(fetchFrom({ today, syncFrom: today, lastSyncedOn: null })).toBe("2025-09-27");
  });
  it("crosses a leap day", () => {
    expect(fetchFrom({ today: "2024-03-10", syncFrom: "2024-03-02", lastSyncedOn: null })).toBe("2024-02-27");
  });
});

describe("sharedSyncFrom", () => {
  it("takes the earliest default", () => {
    expect(sharedSyncFrom(["2026-09-30", "2026-07-15", "2026-08-01"], "2026-07-01")).toBe("2026-07-15");
  });

  it("falls back when no account asks for a date", () => {
    expect(sharedSyncFrom([], "2026-07-01")).toBe("2026-07-01");
  });
});
