import { describe, expect, it } from "vitest";

import { onPaceToOverspend, PACE_FROM_DAY } from "./pace";

const base = { spentCents: 0, recurringSpentCents: 0, billsDueCents: 0, availableCents: 30000 };
const mid = { day: 10, daysInMonth: 30 };

describe("onPaceToOverspend", () => {
  it("extrapolates other spending linearly and flags above the available amount", () => {
    expect(onPaceToOverspend({ ...base, spentCents: 10000 }, mid)).toBe(false); // exactly 30000
    expect(onPaceToOverspend({ ...base, spentCents: 10001 }, mid)).toBe(true);
  });

  it("does not extrapolate recurring charges already paid", () => {
    // Rent 25000 on the 1st plus 1000 of groceries: 25000 + 3000 = 28000.
    expect(onPaceToOverspend({ ...base, spentCents: 26000, recurringSpentCents: 25000 }, mid)).toBe(false);
    expect(onPaceToOverspend({ ...base, spentCents: 26000 }, mid)).toBe(true);
  });

  it("adds bills still due as they are", () => {
    expect(onPaceToOverspend({ ...base, spentCents: 5000, billsDueCents: 15000 }, mid)).toBe(false);
    expect(onPaceToOverspend({ ...base, spentCents: 5000, billsDueCents: 15001 }, mid)).toBe(true);
  });

  it("waits until the 5th and never flags a budget already over", () => {
    expect(onPaceToOverspend({ ...base, spentCents: 20000 }, { day: PACE_FROM_DAY - 1, daysInMonth: 30 })).toBe(false);
    expect(onPaceToOverspend({ ...base, spentCents: 20000 }, { day: PACE_FROM_DAY, daysInMonth: 30 })).toBe(true);
    expect(onPaceToOverspend({ ...base, spentCents: 30001 }, mid)).toBe(false);
  });

  it("stays exact past Number.MAX_SAFE_INTEGER", () => {
    const big = 9_000_000_000_000;
    expect(onPaceToOverspend({ ...base, spentCents: big, availableCents: big * 3 }, mid)).toBe(false);
    expect(onPaceToOverspend({ ...base, spentCents: big + 1, availableCents: big * 3 }, mid)).toBe(true);
  });
});
