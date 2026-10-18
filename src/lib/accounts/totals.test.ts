import { describe, expect, it } from "vitest";

import { accountTotals } from "./totals";

describe("accountTotals", () => {
  it("has no total without any balance", () => {
    expect(accountTotals([])).toMatchObject({ totalCents: null, hasCurrent: false, hasSavings: false });
    expect(accountTotals([{ balanceCents: null, savings: false }]).totalCents).toBeNull();
  });

  it("adds current and savings balances, skipping accounts without one", () => {
    const totals = accountTotals([
      { balanceCents: 218_437, savings: false },
      { balanceCents: 640_000, savings: true },
      { balanceCents: null, savings: false },
      { balanceCents: 14_320, savings: false },
    ]);
    expect(totals).toEqual({ totalCents: 872_757, currentCents: 232_757, savingsCents: 640_000, hasCurrent: true, hasSavings: true });
  });

  it("keeps a negative balance negative", () => {
    expect(accountTotals([{ balanceCents: -5_000, savings: false }, { balanceCents: 2_000, savings: true }]).totalCents).toBe(-3_000);
  });
});
