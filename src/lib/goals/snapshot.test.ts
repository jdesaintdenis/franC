import { describe, expect, it } from "vitest";

import { goalSnapshotSchema } from "./snapshot";

const id = "7b5f3f0e-2f7b-4a3e-9a53-0f3f5a0d9c11";
const goal = {
  id,
  name: "Car",
  targetCents: 300_000,
  targetDate: "2027-06-15",
  icon: "🚗",
  accountId: null,
  startCents: 0,
  startDate: "2026-09-30",
  createdAt: "2026-09-30T10:00:00.000Z",
};

describe("goalSnapshotSchema", () => {
  it("accepts what deleteGoal returns", () => {
    const entry = { id: "0d3c9a42-8c0e-4c1b-8a1d-2b1e7f9a6e55", date: "2026-09-01", amountCents: -500, transactionId: null, createdAt: goal.createdAt };
    expect(goalSnapshotSchema.safeParse({ goal, contributions: [entry], ruleIds: [] }).success).toBe(true);
    const moved = { ...entry, transactionId: id };
    expect(goalSnapshotSchema.safeParse({ goal, contributions: [moved], ruleIds: [id] }).success).toBe(true);
  });

  it("rejects tampered values", () => {
    const bad = (patch: object) => goalSnapshotSchema.safeParse({ goal: { ...goal, ...patch }, contributions: [], ruleIds: [] }).success;
    expect(bad({ id: "nope" })).toBe(false);
    expect(bad({ targetCents: 0 })).toBe(false);
    expect(bad({ targetCents: 1.5 })).toBe(false);
    expect(bad({ name: "" })).toBe(false);
    expect(bad({ startDate: "tomorrow" })).toBe(false);
    const zero = { id, date: "2026-09-01", amountCents: 0, transactionId: null, createdAt: goal.createdAt };
    expect(goalSnapshotSchema.safeParse({ goal, contributions: [zero], ruleIds: [] }).success).toBe(false);
  });
});
