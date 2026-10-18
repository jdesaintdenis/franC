import { addMonthsClamped } from "../recurring/dates";
import { annuityCents, monthlyInsurance, monthlyInterest, type InsuranceTerms } from "./calc";

export interface ProjectionInput {
  owedCents: number;
  rateThousandths: number;
  insurance: InsuranceTerms;
  /** Date of the next payment ("YYYY-MM-DD"); later ones keep its day of month. */
  nextDueDate: string;
  lastPaymentOn: string;
  /** Until this date the monthly payment stays `currentPaymentCents` (deferral, phase 1 of a smoothed loan). */
  currentPaymentUntil: string | null;
  /** Payments before this date are interest-only (a deferral still running). */
  amortizationFrom?: string | null;
  /** The latest payment actually taken, insurance included; without it the deferral pays interest and insurance only. */
  currentPaymentCents: number | null;
  /** Early repayment simulated today: lowers the capital owed, the payment after the deferral stays the same. */
  extraCents?: number;
  paymentAfterDeferralCents?: number | null;
}

export interface ProjectedMonth {
  date: string;
  paymentCents: number;
  interestCents: number;
  insuranceCents: number;
  capitalCents: number;
  owedAfterCents: number;
}

export interface Projection {
  months: ProjectedMonth[];
  endDate: string | null;
  interestLeftCents: number;
  insuranceLeftCents: number;
  /** The constant payment (insurance included) that starts after the deferral, or from now without one. */
  paymentAfterDeferralCents: number | null;
}

const MAX_MONTHS = 600;

/**
 * The payments still to come, month by month, until the last payment date or until the capital is repaid.
 * Without a deferral the payment is the constant annuity on what is owed; a rate-based insurance is part of the
 * annuity's rate so the total stays constant like in the bank's table. The last payment settles what is left.
 */
export function loanProjection(input: ProjectionInput): Projection {
  const dates: string[] = [];
  for (let k = 0; k < MAX_MONTHS; k += 1) {
    const date = addMonthsClamped(input.nextDueDate, k);
    if (date > input.lastPaymentOn) break;
    dates.push(date);
  }

  let owed = Math.max(0, input.owedCents - (input.extraCents ?? 0));
  const months: ProjectedMonth[] = [];
  let after: number | null = input.paymentAfterDeferralCents ?? null;
  const fixedInsurance = input.insurance.insuranceCents;
  const insuranceRate = input.insurance.insuranceRateThousandths ?? 0;

  for (const [index, date] of dates.entries()) {
    if (owed <= 0) break;
    const interest = monthlyInterest(owed, input.rateThousandths);
    const insurance = monthlyInsurance(owed, input.insurance);
    const last = index === dates.length - 1;
    const deferred =
      (input.currentPaymentUntil !== null && date <= input.currentPaymentUntil) ||
      (input.amortizationFrom != null && date < input.amortizationFrom);
    let payment: number;
    if (deferred) {
      payment = input.currentPaymentCents ?? interest + insurance;
    } else {
      if (after === null) {
        const remaining = dates.length - index;
        after = annuityCents(owed, input.rateThousandths + insuranceRate, remaining) + (fixedInsurance ?? 0);
      }
      payment = after;
    }
    let capital = payment - interest - insurance;
    if (last || capital >= owed) {
      capital = owed;
      payment = owed + interest + insurance;
    }
    owed = Math.max(0, owed - capital);
    months.push({ date, paymentCents: payment, interestCents: interest, insuranceCents: insurance, capitalCents: capital, owedAfterCents: owed });
  }
  return {
    months,
    endDate: months.length > 0 && owed <= 0 ? months[months.length - 1].date : null,
    interestLeftCents: months.reduce((sum, m) => sum + m.interestCents, 0),
    insuranceLeftCents: months.reduce((sum, m) => sum + m.insuranceCents, 0),
    paymentAfterDeferralCents: after,
  };
}

export interface EarlyRepaymentResult {
  endDate: string | null;
  monthsSaved: number;
  interestSavedCents: number;
}

/** What an early repayment of `extraCents` today changes: the same payment keeps going, so the loan ends sooner. */
export function simulateEarlyRepayment(input: ProjectionInput, extraCents: number): EarlyRepaymentResult {
  const base = loanProjection(input);
  const faster = loanProjection({ ...input, extraCents, paymentAfterDeferralCents: base.paymentAfterDeferralCents });
  return {
    endDate: faster.endDate,
    monthsSaved: base.months.length - faster.months.length,
    interestSavedCents: base.interestLeftCents - faster.interestLeftCents,
  };
}
