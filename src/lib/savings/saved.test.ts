import { describe, expect, it } from "vitest";

import { savedByMonth, savedContribution, type SavedPair } from "./saved";

const pair = (over: Partial<SavedPair> = {}): SavedPair => ({
  amountCents: 10000,
  outDate: "2026-09-30",
  inDate: "2026-10-01",
  outSavings: false,
  inSavings: true,
  ...over,
});

describe("savedContribution", () => {
  it("counts money into a Savings account, dated on the current-account leg", () => {
    expect(savedContribution(pair())).toEqual({ date: "2026-09-30", cents: 10000 });
  });
  it("counts money back out of savings as negative, dated on the current-account leg", () => {
    expect(savedContribution(pair({ outSavings: true, inSavings: false }))).toEqual({ date: "2026-10-01", cents: -10000 });
  });
  it("ignores pairs between two current accounts or two Savings accounts", () => {
    expect(savedContribution(pair({ inSavings: false }))).toBeNull();
    expect(savedContribution(pair({ outSavings: true }))).toBeNull();
  });
});

describe("savedByMonth", () => {
  it("sums per month and keeps range bounds inclusive", () => {
    const pairs = [
      pair({ outDate: "2026-10-01", amountCents: 5000 }),
      pair({ outDate: "2026-10-31", amountCents: 2500 }),
      pair({ outDate: "2026-11-01", amountCents: 999 }),
      pair({ outSavings: true, inSavings: false, inDate: "2026-10-15", amountCents: 1000 }),
      pair({ inSavings: false }),
    ];
    const month = savedByMonth(pairs, { from: "2026-10-01", to: "2026-10-31" });
    expect([...month]).toEqual([["2026-10", 6500]]);
    const all = savedByMonth(pairs, { from: "2026-10-01", to: "2026-11-30" });
    expect(all.get("2026-11")).toBe(999);
  });
});
