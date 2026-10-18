import { describe, expect, it } from "vitest";

import { monthlyInsurance, monthlyInterest, type InsuranceTerms } from "./calc";
import { backfillPayments, deferralEntry, estimatePeriod } from "./history";
import { loanLedger, type LedgerEntry } from "./ledger";
import { paymentSlots } from "./months";

type Payment = Extract<LedgerEntry, { kind: "payment" }>;

const RATE = 1500; // 1,5 %
const BORROWED = 20_000_00;
const LAST = "2031-03-05";
const START = "2021-03-05";
const DEFER_UNTIL = "2022-03-05"; // first capital payment
const PAYMENT = 400_00;

function forward(insurance: InsuranceTerms) {
  const slots = paymentSlots(LAST, START).filter((d) => d <= "2025-03-05");
  const payments = slots.map((date) => ({
    transactionId: `t-${date}`,
    date,
    amountCents: -(date < DEFER_UNTIL ? monthlyInterest(BORROWED, RATE) + monthlyInsurance(BORROWED, insurance) : PAYMENT),
  }));
  return { slots, payments, ledger: loanLedger({ checkpoints: [{ date: START, owedCents: BORROWED }], rateThousandths: RATE, insurance, payments, splits: new Map() }) };
}

const ins: InsuranceTerms[] = [
  { insuranceCents: null, insuranceRateThousandths: 370 },
  { insuranceCents: 600, insuranceRateThousandths: null },
];

describe.each(ins)("loan history %#", (insurance) => {
  const f = forward(insurance);
  const realFrom = "2024-12-05";
  const real = f.payments.filter((p) => p.date >= realFrom && p.date < "2025-03-05");
  const forwardPayments = f.ledger.entries.filter((e): e is Payment => e.kind === "payment");
  const before = forwardPayments.filter((e) => e.date >= realFrom && e.date < "2025-03-05");
  const anchorOwed = forwardPayments.filter((e) => e.date < "2025-03-05").at(-1)?.owedAfterCents ?? 0;

  it("replays real payments backwards to the cent", () => {
    const back = backfillPayments({ anchorOwedCents: anchorOwed, rateThousandths: RATE, insurance, payments: real, splits: new Map() });
    expect(back.entries.map((e) => [e.date, e.interestCents, e.insuranceCents, e.capitalCents, e.owedAfterCents])).toEqual(
      before.map((e) => [e.date, e.interestCents, e.insuranceCents, e.capitalCents, e.owedAfterCents]),
    );
    const firstReal = forwardPayments.find((e) => e.date === realFrom) as Payment;
    expect(back.owedBeforeCents).toBe(firstReal.owedAfterCents + firstReal.capitalCents);
  });

  it("computes the deferral exactly and estimates the rest with an exact capital", () => {
    const back = backfillPayments({ anchorOwedCents: anchorOwed, rateThousandths: RATE, insurance, payments: real, splits: new Map() });
    const input = {
      startedOn: START,
      amortizationFrom: DEFER_UNTIL,
      lastPaymentOn: LAST,
      borrowedCents: BORROWED,
      rateThousandths: RATE,
      insurance,
      until: realFrom,
      owedAtUntilCents: back.owedBeforeCents,
    };
    const deferral = deferralEntry(input);
    const deferred = forwardPayments.filter((e) => e.date < DEFER_UNTIL);
    expect(deferral?.months).toBe(deferred.length);
    expect(deferral?.interestCents).toBe(deferred.reduce((s, e) => s + e.interestCents, 0));
    expect(deferral?.insuranceCents).toBe(deferred.reduce((s, e) => s + e.insuranceCents, 0));

    const estimated = estimatePeriod(input);
    const middle = forwardPayments.filter((e) => e.date >= DEFER_UNTIL && e.date < realFrom);
    expect(estimated?.months).toBe(middle.length);
    expect(estimated?.capitalCents).toBe(BORROWED - back.owedBeforeCents);
    expect(Math.abs((estimated?.interestCents ?? 0) - middle.reduce((s, e) => s + e.interestCents, 0))).toBeLessThanOrEqual(100_00);
    expect(Math.abs((estimated?.insuranceCents ?? 0) - middle.reduce((s, e) => s + e.insuranceCents, 0))).toBeLessThanOrEqual(100_00);
  });
});

describe("edge cases", () => {
  const insurance: InsuranceTerms = { insuranceCents: 0, insuranceRateThousandths: null };
  const base = { startedOn: START, amortizationFrom: null, lastPaymentOn: LAST, borrowedCents: BORROWED, rateThousandths: RATE, insurance, until: "2025-03-05", owedAtUntilCents: 12_000_00 };

  it("has no deferral without a capital start date", () => {
    expect(deferralEntry(base)).toBeNull();
  });
  it("has no estimate when nothing is missing or the figure is above the borrowed amount", () => {
    expect(estimatePeriod({ ...base, until: "2021-03-05" })).toBeNull();
    expect(estimatePeriod({ ...base, owedAtUntilCents: BORROWED + 1 })).toBeNull();
  });
  it("honors a split override", () => {
    const back = backfillPayments({
      anchorOwedCents: 10_000_00,
      rateThousandths: RATE,
      insurance,
      payments: [{ transactionId: "a", date: "2025-02-05", amountCents: -300_00 }],
      splits: new Map([["a", { interestCents: 20_00, insuranceCents: 5_00 }]]),
    });
    expect(back.entries[0]).toMatchObject({ interestCents: 20_00, insuranceCents: 5_00, capitalCents: 275_00, corrected: true });
    expect(back.owedBeforeCents).toBe(10_275_00);
  });
  it("treats a second payment in a month as all capital", () => {
    const back = backfillPayments({
      anchorOwedCents: 10_000_00,
      rateThousandths: RATE,
      insurance,
      payments: [
        { transactionId: "a", date: "2025-02-05", amountCents: -300_00 },
        { transactionId: "b", date: "2025-02-20", amountCents: -100_00 },
      ],
      splits: new Map(),
    });
    expect(back.entries[1]).toMatchObject({ interestCents: 0, capitalCents: 100_00 });
    expect(back.entries[0].interestCents).toBeGreaterThan(0);
  });
});
