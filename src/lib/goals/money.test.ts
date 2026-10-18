import { describe, expect, it } from "vitest";

import { assignedPercent, canAssign, goalMoneyByAccount } from "./money";

const balances = [
  { id: "a", balanceCents: 100_000 },
  { id: "b", balanceCents: null },
];

describe("goalMoneyByAccount", () => {
  it("sums what goals of one account hold and leaves the rest not assigned", () => {
    const money = goalMoneyByAccount(
      [
        { accountId: "a", savedCents: 30_000 },
        { accountId: "a", savedCents: 20_000 },
      ],
      balances,
    );
    expect(money.get("a")).toEqual({ accountId: "a", balanceCents: 100_000, assignedCents: 50_000, notAssignedCents: 50_000 });
  });

  it("ignores manual goals", () => {
    expect(goalMoneyByAccount([{ accountId: null, savedCents: 500 }], balances).size).toBe(0);
  });

  it("has no not-assigned amount without a balance", () => {
    expect(goalMoneyByAccount([{ accountId: "b", savedCents: 500 }], balances).get("b")?.notAssignedCents).toBeNull();
  });

  it("keeps a negative not-assigned amount", () => {
    expect(goalMoneyByAccount([{ accountId: "a", savedCents: 120_000 }], balances).get("a")?.notAssignedCents).toBe(-20_000);
  });
});

describe("canAssign", () => {
  const money = goalMoneyByAccount([{ accountId: "a", savedCents: 60_000 }], balances).get("a");

  it("allows exactly what is not assigned", () => {
    expect(canAssign(money, 40_000)).toBeNull();
  });

  it("refuses one cent more", () => {
    expect(canAssign(money, 40_001)).toBe("exceedsNotAssigned");
  });

  it("refuses without a balance", () => {
    expect(canAssign(goalMoneyByAccount([{ accountId: "b", savedCents: 0 }], balances).get("b"), 1)).toBe("noBalance");
    expect(canAssign(undefined, 1)).toBe("noBalance");
  });
});

describe("assignedPercent", () => {
  it("is null without a balance", () => {
    expect(assignedPercent({ balanceCents: null, assignedCents: 500 })).toBeNull();
  });
  it("is the assigned share of the balance", () => {
    expect(assignedPercent({ balanceCents: 320_000, assignedCents: 200_000 })).toBe(62);
    expect(assignedPercent({ balanceCents: 320_000, assignedCents: 0 })).toBe(0);
  });
  it("is full when over-assigned or the balance is not positive", () => {
    expect(assignedPercent({ balanceCents: 80_000, assignedCents: 100_000 })).toBe(100);
    expect(assignedPercent({ balanceCents: 0, assignedCents: 0 })).toBe(100);
  });
});
