import { describe, expect, it } from "vitest";

import { isPossiblyCancelled, missedCycles, type CancelledCheck } from "./missed";

describe("missedCycles", () => {
  it("counts nothing while the next charge isn't due yet", () => {
    expect(missedCycles("2026-06-15", "monthly", "2026-07-10")).toBe(0);
  });

  it("doesn't count a charge that is a few days late (within the grace period)", () => {
    // Due 15 July, grace 3 days: 18 July is still in time.
    expect(missedCycles("2026-06-15", "monthly", "2026-07-18")).toBe(0);
    expect(missedCycles("2026-06-15", "monthly", "2026-07-19")).toBe(1);
  });

  it("counts two missed monthly charges", () => {
    expect(missedCycles("2026-06-15", "monthly", "2026-08-19")).toBe(2);
  });

  it("counts weekly charges", () => {
    // Due 8, 15, 22 Sept; grace 2 days.
    expect(missedCycles("2026-09-01", "weekly", "2026-09-10")).toBe(0);
    expect(missedCycles("2026-09-01", "weekly", "2026-09-18")).toBe(2);
    expect(missedCycles("2026-09-01", "weekly", "2026-09-25")).toBe(3);
  });

  it("counts yearly charges", () => {
    expect(missedCycles("2024-03-01", "yearly", "2025-03-11")).toBe(0);
    expect(missedCycles("2024-03-01", "yearly", "2025-03-12")).toBe(1);
    expect(missedCycles("2024-03-01", "yearly", "2026-03-12")).toBe(2);
  });

  it("steps month ends without drift (31 Jan, 28 Feb, 31 Mar)", () => {
    // Due 28 Feb then 31 Mar: 3 Apr is within the grace of the 31st.
    expect(missedCycles("2026-01-31", "monthly", "2026-04-03")).toBe(1);
    expect(missedCycles("2026-01-31", "monthly", "2026-04-04")).toBe(2);
  });
});

const base: CancelledCheck = {
  status: "confirmed",
  interval: "monthly",
  lastSeenDate: "2026-06-15",
  accountLatestDate: "2026-08-20",
  stillActiveAt: null,
};

describe("isPossiblyCancelled", () => {
  it("flags a confirmed item after two missed charges", () => {
    expect(isPossiblyCancelled(base)).toBe(true);
  });

  it("doesn't flag after one missed charge", () => {
    expect(isPossiblyCancelled({ ...base, accountLatestDate: "2026-07-20" })).toBe(false);
  });

  it("never flags detected or ended items", () => {
    expect(isPossiblyCancelled({ ...base, status: "detected" })).toBe(false);
    expect(isPossiblyCancelled({ ...base, status: "ended" })).toBe(false);
  });

  it("doesn't flag an account without transactions", () => {
    expect(isPossiblyCancelled({ ...base, accountLatestDate: null })).toBe(false);
  });

  it("stays hidden after 'Still active' until one more charge is missed", () => {
    const answered = { ...base, stillActiveAt: "2026-08-20" };
    expect(isPossiblyCancelled(answered)).toBe(false);
    expect(isPossiblyCancelled({ ...answered, accountLatestDate: "2026-09-10" })).toBe(false);
    expect(isPossiblyCancelled({ ...answered, accountLatestDate: "2026-09-19" })).toBe(true);
  });

  it("forgets 'Still active' once a new charge arrives", () => {
    // New charge on 15 Sept; the old answer counts nothing missed from it.
    expect(
      isPossiblyCancelled({ ...base, lastSeenDate: "2026-09-15", stillActiveAt: "2026-08-20", accountLatestDate: "2026-11-19" }),
    ).toBe(true);
  });
});
