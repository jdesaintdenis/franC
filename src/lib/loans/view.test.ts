import { describe, expect, it } from "vitest";

import { loanView, type LoanViewInput } from "./view";

const input: LoanViewInput = {
  loan: { borrowedCents: 2_000_000, rateThousandths: 1200, insuranceCents: 500, insuranceRateThousandths: null, lastPaymentOn: "2027-12-05", currentPaymentUntil: null },
  checkpoints: [{ date: "2026-01-01", owedCents: 1_000_000 }],
  payments: [
    { transactionId: "a", date: "2026-02-05", amountCents: -20_000 },
    { transactionId: "b", date: "2026-03-05", amountCents: -19_500 },
  ],
  splits: new Map(),
  item: { nextExpectedDate: "2026-04-05", typicalAmountCents: -20_000 },
};

describe("loanView", () => {
  it("combines the ledger and the projection", () => {
    const view = loanView(input, "2026-03-20");
    expect(view.owedCents).toBe(view.ledger.owedCents);
    expect(view.repaidPercent).toBe(Math.floor(((2_000_000 - view.owedCents) * 100) / 2_000_000));
    expect(view.nextDue).toBe("2026-04-05");
    expect(view.projection.months[0].date).toBe("2026-04-05");
    expect(view.endDate).toBe("2027-12-05");
    expect(view.paidInterestAndInsuranceCents).toBeGreaterThan(0);
  });

  it("reports how much the bank took compared with the payment before", () => {
    const view = loanView(input, "2026-03-20");
    expect(view.changeFromPreviousCents.get("b")).toBe(-500);
    expect(view.changeFromPreviousCents.has("a")).toBe(false);
  });

  it("has no next payment once everything is repaid", () => {
    const view = loanView({ ...input, checkpoints: [{ date: "2026-01-01", owedCents: 0 }], payments: [] }, "2026-03-20");
    expect(view.nextDue).toBeNull();
  });

  it("builds the history before the first figure and keeps everything after it unchanged", () => {
    const withHistory: LoanViewInput = {
      ...input,
      loan: { ...input.loan, startedOn: "2025-01-05", amortizationFrom: "2025-07-05" },
      checkpoints: [{ date: "2026-01-01", owedCents: 1_000_000 }],
      payments: [{ transactionId: "p", date: "2025-12-05", amountCents: -20_000 }, ...input.payments],
    };
    const view = loanView(withHistory, "2026-03-20");
    expect(view.owedCents).toBe(loanView(input, "2026-03-20").owedCents);
    expect(view.history.map((e) => e.kind)).toEqual(["deferral", "estimated", "payment"]);
    expect(view.deferralCostCents).toBeGreaterThan(0);
    expect(view.estimatedCostCents).toBeGreaterThan(0);
    expect(view.length).toMatchObject({ monthsTotal: 35, monthsPaid: 14 });
    expect(view.paidInterestAndInsuranceCents).toBeGreaterThan(loanView(input, "2026-03-20").paidInterestAndInsuranceCents);
  });

  it("shows a visible correction instead of an estimate when real payments reach back to the borrowed figure", () => {
    const view = loanView(
      { ...input, loan: { ...input.loan, startedOn: "2025-11-05" }, payments: [{ transactionId: "p", date: "2025-11-05", amountCents: -20_000 }, ...input.payments] },
      "2026-03-20",
    );
    expect(view.history.map((e) => e.kind)).toEqual(["correction", "payment"]);
  });

  it("without a subscription date nothing changes", () => {
    expect(loanView(input, "2026-03-20").history).toEqual([]);
  });
});
