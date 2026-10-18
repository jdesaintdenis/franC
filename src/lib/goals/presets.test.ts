import { describe, expect, it } from "vitest";

import { contributionPresets } from "./presets";

const base = { mode: "manual", direction: "add", monthlyCents: 27_778, remainingCents: 210_000, notAssignedCents: null } as const;

describe("contributionPresets", () => {
  it("offers the monthly amount and what finishes the goal when adding by hand", () => {
    expect(contributionPresets(base)).toEqual([
      { kind: "monthly", cents: 27_778 },
      { kind: "remaining", cents: 210_000 },
    ]);
  });

  it("has nothing when taking money out", () => {
    expect(contributionPresets({ ...base, direction: "remove" })).toEqual([]);
  });

  it("skips a monthly amount without a date and a remaining amount of zero", () => {
    expect(contributionPresets({ ...base, monthlyCents: null, remainingCents: 0 })).toEqual([]);
  });

  it("adds everything the account has left, only when assigning", () => {
    const assign = { ...base, mode: "assign", notAssignedCents: 50_000 } as const;
    expect(contributionPresets(assign).map((p) => p.kind)).toEqual(["monthly", "remaining", "all"]);
    expect(contributionPresets({ ...assign, notAssignedCents: 0 }).map((p) => p.kind)).toEqual(["monthly", "remaining"]);
    expect(contributionPresets({ ...base, notAssignedCents: 50_000 }).map((p) => p.kind)).toEqual(["monthly", "remaining"]);
  });

  it("drops a preset that repeats an earlier amount", () => {
    expect(contributionPresets({ ...base, mode: "assign", remainingCents: 50_000, notAssignedCents: 50_000 })).toEqual([
      { kind: "monthly", cents: 27_778 },
      { kind: "remaining", cents: 50_000 },
    ]);
  });
});
