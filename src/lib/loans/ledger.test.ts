import { describe, expect, it } from "vitest";

import { loanLedger, type LedgerEntry } from "./ledger";

// Synthetic loan: 10 000,00 € at 1,200 % → 10,00 € of interest a month; 5,00 € of insurance a month.
const base = {
  checkpoints: [{ date: "2026-01-01", owedCents: 1_000_000 }],
  rateThousandths: 1200,
  insurance: { insuranceCents: 500, insuranceRateThousandths: null },
  splits: new Map<string, { interestCents: number; insuranceCents: number }>(),
};
const pay = (id: string, date: string, cents: number) => ({ transactionId: id, date, amountCents: -cents });
const payments = (entries: LedgerEntry[]) => entries.filter((e) => e.kind === "payment");

describe("loanLedger", () => {
  it("splits a payment into interest, insurance and capital", () => {
    const { entries, owedCents } = loanLedger({ ...base, payments: [pay("a", "2026-02-05", 20_000)] });
    expect(entries).toEqual([
      expect.objectContaining({ interestCents: 1000, insuranceCents: 500, capitalCents: 18_500, owedAfterCents: 981_500, corrected: false }),
    ]);
    expect(owedCents).toBe(981_500);
  });

  it("charges interest on what is left the next month", () => {
    const { entries } = loanLedger({ ...base, payments: [pay("a", "2026-02-05", 20_000), pay("b", "2026-03-05", 20_000)] });
    // 9 815,00 € × 1,2 % ÷ 12 = 9,815 → 9,82 €
    expect(payments(entries)[1]).toMatchObject({ interestCents: 982, capitalCents: 20_000 - 982 - 500 });
  });

  it("keeps the balance flat while only interest and insurance are paid (deferral)", () => {
    const { owedCents } = loanLedger({ ...base, payments: [pay("a", "2026-02-05", 1500), pay("b", "2026-03-05", 1500)] });
    expect(owedCents).toBe(1_000_000);
  });

  it("repays 5 € less capital when the bank takes 5 € less", () => {
    const { entries } = loanLedger({ ...base, payments: [pay("a", "2026-02-05", 19_500)] });
    expect(payments(entries)[0]).toMatchObject({ paidCents: 19_500, capitalCents: 18_000 });
  });

  it("counts a second payment in the same month as capital only", () => {
    const { entries } = loanLedger({ ...base, payments: [pay("a", "2026-02-05", 20_000), pay("b", "2026-02-20", 10_000)] });
    expect(payments(entries)[1]).toMatchObject({ interestCents: 0, insuranceCents: 0, capitalCents: 10_000 });
  });

  it("lets the capital owed grow when a payment doesn't cover the interest", () => {
    const { entries, owedCents } = loanLedger({ ...base, payments: [pay("a", "2026-02-05", 1000)] });
    expect(payments(entries)[0]).toMatchObject({ capitalCents: -500 });
    expect(owedCents).toBe(1_000_500);
  });

  it("never goes below zero", () => {
    const { owedCents, entries } = loanLedger({
      ...base,
      checkpoints: [{ date: "2026-01-01", owedCents: 1000 }],
      payments: [pay("a", "2026-02-05", 50_000)],
    });
    expect(owedCents).toBe(0);
    expect(payments(entries)[0]).toMatchObject({ capitalCents: 1000 });
  });

  it("charges a yearly insurance rate on the capital owed", () => {
    const { entries } = loanLedger({
      ...base,
      insurance: { insuranceCents: null, insuranceRateThousandths: 360 },
      payments: [pay("a", "2026-02-05", 20_000)],
    });
    // 10 000,00 € × 0,36 % ÷ 12 = 3,00 €
    expect(payments(entries)[0]).toMatchObject({ insuranceCents: 300, capitalCents: 18_700 });
  });

  it("ignores payments before the loan's start", () => {
    const { entries } = loanLedger({ ...base, payments: [pay("a", "2025-12-05", 20_000)] });
    expect(entries).toEqual([]);
  });

  it("resets the capital owed at a later checkpoint and records the correction", () => {
    const { entries, owedCents } = loanLedger({
      ...base,
      checkpoints: [
        { date: "2026-01-01", owedCents: 1_000_000 },
        { id: "c1", date: "2026-02-10", owedCents: 970_000 },
      ],
      payments: [pay("a", "2026-02-05", 20_000), pay("b", "2026-03-05", 20_000)],
    });
    expect(entries[1]).toEqual({ kind: "correction", date: "2026-02-10", checkpointId: "c1", deltaCents: -11_500, owedAfterCents: 970_000 });
    expect(owedCents).toBeLessThan(970_000);
    expect(payments(entries)[1]).toMatchObject({ interestCents: 970 });
  });

  it("uses the interest and insurance the user set for a payment", () => {
    const { entries } = loanLedger({
      ...base,
      payments: [pay("a", "2026-02-05", 20_000)],
      splits: new Map([["a", { interestCents: 1200, insuranceCents: 600 }]]),
    });
    expect(payments(entries)[0]).toMatchObject({ interestCents: 1200, insuranceCents: 600, capitalCents: 18_200, corrected: true });
  });

  it("returns an empty ledger without a checkpoint", () => {
    expect(loanLedger({ ...base, checkpoints: [], payments: [] })).toEqual({ entries: [], owedCents: 0, startDate: "" });
  });
});
