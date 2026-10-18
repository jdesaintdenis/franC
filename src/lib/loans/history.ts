import { monthlyInsurance, monthlyInterest, type InsuranceTerms } from "./calc";
import { loanLedger, type LedgerEntry, type LedgerPayment, type PaymentSplit } from "./ledger";
import { paymentSlots } from "./months";

type PaymentEntry = Extract<LedgerEntry, { kind: "payment" }>;
type DeferralEntry = Extract<LedgerEntry, { kind: "deferral" }>;
type EstimatedEntry = Extract<LedgerEntry, { kind: "estimated" }>;

const ITERATIONS = 40;

/** Smallest integer in [lo, hi] for which `ok` holds (ok is monotonic: false… then true…); `hi` when none. */
function smallestWhere(lo: number, hi: number, ok: (n: number) => boolean): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < ITERATIONS && a < b; i += 1) {
    const mid = Math.floor((a + b) / 2);
    if (ok(mid)) b = mid;
    else a = mid + 1;
  }
  return a;
}

/**
 * Real payments taken BEFORE the capital owed was given, replayed backwards from that figure: for each one, the
 * capital owed before it is the amount that, after the payment's interest, insurance and capital, leaves exactly
 * what was owed after it. Exact given the rate and insurance, so these rows never depend on an estimate.
 * Same charging rule as `loanLedger`: interest and insurance once per calendar month, on its first payment.
 */
export function backfillPayments(input: {
  anchorOwedCents: number;
  rateThousandths: number;
  insurance: InsuranceTerms;
  /** Outflows dated before the anchor. */
  payments: ReadonlyArray<LedgerPayment>;
  splits: ReadonlyMap<string, PaymentSplit>;
}): { entries: PaymentEntry[]; owedBeforeCents: number } {
  const sorted = input.payments
    .filter((p) => p.amountCents < 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.transactionId.localeCompare(b.transactionId));
  const entries: PaymentEntry[] = [];
  let after = input.anchorOwedCents;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const payment = sorted[i];
    const paid = -payment.amountCents;
    const month = payment.date.slice(0, 7);
    const firstOfMonth = i === 0 || sorted[i - 1].date.slice(0, 7) !== month;
    const split = input.splits.get(payment.transactionId);
    let before: number;
    let interest = 0;
    let insurance = 0;
    if (split) {
      interest = split.interestCents;
      insurance = split.insuranceCents;
      before = after + Math.max(0, paid - interest - insurance);
    } else if (!firstOfMonth) {
      before = after + paid;
    } else {
      const charged = (owed: number) => owed + monthlyInterest(owed, input.rateThousandths) + monthlyInsurance(owed, input.insurance);
      before = smallestWhere(0, after + paid, (owed) => charged(owed) >= after + paid);
      interest = monthlyInterest(before, input.rateThousandths);
      insurance = monthlyInsurance(before, input.insurance);
    }
    entries.push({
      kind: "payment",
      transactionId: payment.transactionId,
      date: payment.date,
      paidCents: paid,
      interestCents: interest,
      insuranceCents: insurance,
      capitalCents: before - after,
      owedAfterCents: after,
      corrected: split !== undefined,
    });
    after = before;
  }
  return { entries: entries.reverse(), owedBeforeCents: after };
}

export interface HistoryInput {
  startedOn: string;
  amortizationFrom: string | null;
  lastPaymentOn: string;
  borrowedCents: number;
  rateThousandths: number;
  insurance: InsuranceTerms;
  /** Date of the oldest real payment (or the anchor): the history ends before it. */
  until: string;
  /** Capital owed just before `until`. */
  owedAtUntilCents: number;
}

/** The deferral: the capital stays `borrowed`, so each month's interest and insurance are known exactly. */
export function deferralEntry(input: HistoryInput): DeferralEntry | null {
  if (input.amortizationFrom === null) return null;
  const end = input.amortizationFrom < input.until ? input.amortizationFrom : input.until;
  const slots = paymentSlots(input.lastPaymentOn, input.startedOn).filter((d) => d < end);
  if (slots.length === 0) return null;
  return {
    kind: "deferral",
    from: slots[0],
    to: slots[slots.length - 1],
    months: slots.length,
    interestCents: slots.length * monthlyInterest(input.borrowedCents, input.rateThousandths),
    insuranceCents: slots.length * monthlyInsurance(input.borrowedCents, input.insurance),
    owedAfterCents: input.borrowedCents,
  };
}

/**
 * The months between the deferral and the first real payment, as ONE estimate. The capital repaid is exact
 * (borrowed − owed before the first real payment); only the interest and insurance totals are estimated, by
 * replaying a constant payment chosen so the replay ends on that capital. The monthly replay is discarded.
 * Shortcut: a smoothed loan's first phase inside this period is approximated by the same constant payment.
 */
export function estimatePeriod(input: HistoryInput): EstimatedEntry | null {
  const months = paymentSlots(input.lastPaymentOn, input.startedOn).filter(
    (d) => (input.amortizationFrom === null || d >= input.amortizationFrom) && d < input.until,
  );
  if (months.length === 0 || input.owedAtUntilCents > input.borrowedCents) return null;

  const replay = (paymentCents: number) =>
    loanLedger({
      checkpoints: [{ date: months[0], owedCents: input.borrowedCents }],
      rateThousandths: input.rateThousandths,
      insurance: input.insurance,
      payments: months.map((date) => ({ transactionId: `est:${date}`, date, amountCents: -paymentCents })),
      splits: new Map(),
    });
  const target = input.owedAtUntilCents;
  const high = input.borrowedCents * 2;
  const upper = smallestWhere(0, high, (p) => replay(p).owedCents <= target);
  const best = upper > 0 && Math.abs(replay(upper - 1).owedCents - target) < Math.abs(replay(upper).owedCents - target) ? upper - 1 : upper;
  const entries = replay(best).entries.filter((e): e is PaymentEntry => e.kind === "payment");
  return {
    kind: "estimated",
    from: months[0],
    to: months[months.length - 1],
    months: months.length,
    capitalCents: input.borrowedCents - input.owedAtUntilCents,
    interestCents: entries.reduce((sum, e) => sum + e.interestCents, 0),
    insuranceCents: entries.reduce((sum, e) => sum + e.insuranceCents, 0),
    owedAfterCents: input.owedAtUntilCents,
  };
}
