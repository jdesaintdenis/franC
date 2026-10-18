import { describe, expect, it } from "vitest";

import { budgetSnapshotSchema } from "./snapshot";

const base = {
  categoryId: "3f2b8c1e-5d4a-4f6b-9a7c-1d2e3f4a5b6c",
  amountCents: 12000,
  rollover: true,
  rolloverStart: "2026-03-01",
  rolloverBaseCents: -4500,
};

describe("budgetSnapshotSchema", () => {
  it("accepts a rollover budget and one without rollover", () => {
    expect(budgetSnapshotSchema.safeParse(base).success).toBe(true);
    expect(
      budgetSnapshotSchema.safeParse({ ...base, rollover: false, rolloverStart: null, rolloverBaseCents: 0 }).success,
    ).toBe(true);
  });

  it("refuses amounts outside 1..max and non-integers", () => {
    for (const amountCents of [0, -1, 1_000_000_001, 10.5]) {
      expect(budgetSnapshotSchema.safeParse({ ...base, amountCents }).success).toBe(false);
    }
  });

  it("refuses a start that is not the 1st of a month", () => {
    for (const rolloverStart of ["2026-03-02", "2026-13-01", "2026-3-01", "not a date"]) {
      expect(budgetSnapshotSchema.safeParse({ ...base, rolloverStart }).success).toBe(false);
    }
  });

  it("keeps the start consistent with the rollover flag", () => {
    expect(budgetSnapshotSchema.safeParse({ ...base, rolloverStart: null }).success).toBe(false);
    expect(budgetSnapshotSchema.safeParse({ ...base, rollover: false }).success).toBe(false);
    expect(
      budgetSnapshotSchema.safeParse({ ...base, rollover: false, rolloverStart: null, rolloverBaseCents: 5 }).success,
    ).toBe(false);
  });

  it("bounds the carry base", () => {
    expect(budgetSnapshotSchema.safeParse({ ...base, rolloverBaseCents: 2e15 }).success).toBe(false);
    expect(budgetSnapshotSchema.safeParse({ ...base, rolloverBaseCents: -2e15 }).success).toBe(false);
  });

  it("refuses an id that is not a uuid", () => {
    expect(budgetSnapshotSchema.safeParse({ ...base, categoryId: "x" }).success).toBe(false);
  });
});
