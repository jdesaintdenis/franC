import { describe, expect, it } from "vitest";

import { loanProjection, simulateEarlyRepayment, type ProjectionInput } from "./projection";

// Synthetic: 12 000,00 € owed, 1,2 % a year, 6,00 € insurance a month, 12 monthly payments on the 5th.
const input: ProjectionInput = {
  owedCents: 1_200_000,
  rateThousandths: 1200,
  insurance: { insuranceCents: 600, insuranceRateThousandths: null },
  nextDueDate: "2026-11-05",
  lastPaymentOn: "2027-10-05",
  currentPaymentUntil: null,
  currentPaymentCents: null,
};

describe("loanProjection", () => {
  it("repays everything over the remaining months with a constant payment", () => {
    const p = loanProjection(input);
    expect(p.months).toHaveLength(12);
    expect(p.endDate).toBe("2027-10-05");
    expect(p.months.at(-1)?.owedAfterCents).toBe(0);
    expect(p.months.reduce((sum, m) => sum + m.capitalCents, 0)).toBe(1_200_000);
    const constant = p.months.slice(0, -1).map((m) => m.paymentCents);
    expect(new Set(constant).size).toBe(1);
    expect(p.paymentAfterDeferralCents).toBe(constant[0]);
    expect(p.interestLeftCents).toBeGreaterThan(0);
    expect(p.insuranceLeftCents).toBe(12 * 600);
  });

  it("keeps the total constant when the insurance is a rate on the capital owed", () => {
    const p = loanProjection({ ...input, insurance: { insuranceCents: null, insuranceRateThousandths: 360 } });
    const payments = p.months.slice(0, -1).map((m) => m.paymentCents);
    expect(Math.max(...payments) - Math.min(...payments)).toBeLessThanOrEqual(2);
    expect(p.months.reduce((sum, m) => sum + m.capitalCents, 0)).toBe(1_200_000);
  });

  it("works at a 0 % rate", () => {
    const p = loanProjection({ ...input, rateThousandths: 0, insurance: { insuranceCents: 0, insuranceRateThousandths: null } });
    expect(p.months[0].paymentCents).toBe(100_000);
    expect(p.interestLeftCents).toBe(0);
  });

  it("keeps the current payment until the deferral ends, then runs a constant payment", () => {
    const p = loanProjection({ ...input, currentPaymentUntil: "2027-01-05", currentPaymentCents: 1_600 });
    // Nov, Dec, Jan: 16,00 € = 12,00 € interest + 6,00 € insurance − rounding → capital stays about flat.
    expect(p.months.slice(0, 3).every((m) => m.paymentCents === 1_600)).toBe(true);
    expect(p.months[3].paymentCents).toBeGreaterThan(1_600);
    expect(p.months.at(-1)?.owedAfterCents).toBe(0);
    expect(p.paymentAfterDeferralCents).toBe(p.months[3].paymentCents);
  });

  it("pays interest and insurance only during a deferral when the current payment is unknown", () => {
    const p = loanProjection({ ...input, currentPaymentUntil: "2026-12-05" });
    expect(p.months[0].capitalCents).toBe(0);
    expect(p.months[0].paymentCents).toBe(p.months[0].interestCents + 600);
  });

  it("is empty when the next payment is after the last one", () => {
    const p = loanProjection({ ...input, nextDueDate: "2027-11-05" });
    expect(p).toMatchObject({ months: [], endDate: null, paymentAfterDeferralCents: null });
  });

  it("pays interest and insurance only while a deferral is still running", () => {
    const p = loanProjection({ ...input, amortizationFrom: "2027-01-05" });
    const deferred = p.months.filter((m) => m.date < "2027-01-05");
    expect(deferred).toHaveLength(2);
    expect(deferred.every((m) => m.capitalCents === 0 && m.owedAfterCents === 1_200_000)).toBe(true);
    expect(p.months.at(-1)?.owedAfterCents).toBe(0);
  });

  it("stops when nothing is owed", () => {
    expect(loanProjection({ ...input, owedCents: 0 }).months).toEqual([]);
  });
});

describe("simulateEarlyRepayment", () => {
  it("ends sooner and saves interest when the same payment keeps going", () => {
    const r = simulateEarlyRepayment(input, 300_000);
    expect(r.monthsSaved).toBeGreaterThan(0);
    expect(r.interestSavedCents).toBeGreaterThan(0);
    expect(r.endDate! < "2027-10-05").toBe(true);
  });

  it("changes nothing for 0 €", () => {
    expect(simulateEarlyRepayment(input, 0)).toMatchObject({ monthsSaved: 0, interestSavedCents: 0 });
  });
});
