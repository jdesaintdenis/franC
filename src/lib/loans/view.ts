import type { InsuranceTerms } from "./calc";
import { backfillPayments, deferralEntry, estimatePeriod } from "./history";
import { loanLedger, type Ledger, type LedgerCheckpoint, type LedgerEntry, type LedgerPayment, type PaymentSplit } from "./ledger";
import { loanLength, type LoanLength } from "./months";
import { nextDueDate } from "./next-due";
import { repaidPercent } from "./progress";
import { loanProjection, type Projection, type ProjectionInput } from "./projection";

export interface LoanViewInput {
  loan: {
    borrowedCents: number;
    rateThousandths: number;
    insuranceCents: number | null;
    insuranceRateThousandths: number | null;
    lastPaymentOn: string;
    currentPaymentUntil: string | null;
    startedOn?: string | null;
    amortizationFrom?: string | null;
  };
  checkpoints: ReadonlyArray<LedgerCheckpoint & { id?: string }>;
  payments: ReadonlyArray<LedgerPayment>;
  splits: ReadonlyMap<string, PaymentSplit>;
  /** The regular payment that pays the loan. */
  item: { nextExpectedDate: string | null; typicalAmountCents: number } | null;
}

export interface LoanView {
  ledger: Ledger;
  owedCents: number;
  repaidPercent: number;
  /** Null once nothing is owed. */
  nextDue: string | null;
  projectionInput: ProjectionInput;
  projection: Projection;
  /** "YYYY-MM-DD": when the loan ends: the projection's end, else the contractual last payment. */
  endDate: string;
  paidInterestAndInsuranceCents: number;
  /** Oldest first, all before the first checkpoint: deferral, estimated period or gap, then real payments. */
  history: LedgerEntry[];
  length: LoanLength;
  /** Interest + insurance of the deferral and of the estimated period (already inside the paid total). */
  deferralCostCents: number;
  estimatedCostCents: number;
  /** Per payment: how much more (+) or less (−) the bank took than the payment before it. */
  changeFromPreviousCents: Map<string, number>;
}

/** Everything a loan screen shows, from the raw data. Pure: `today` is "YYYY-MM-DD". */
export function loanView(input: LoanViewInput, today: string): LoanView {
  const insurance: InsuranceTerms = { insuranceCents: input.loan.insuranceCents, insuranceRateThousandths: input.loan.insuranceRateThousandths };
  const ledger = loanLedger({ checkpoints: input.checkpoints, rateThousandths: input.loan.rateThousandths, insurance, payments: input.payments, splits: input.splits });
  const startedOn = input.loan.startedOn ?? null;
  const amortizationFrom = input.loan.amortizationFrom ?? null;
  const history = startedOn ? buildHistory(input, insurance, startedOn, amortizationFrom) : [];
  const historyPayments = history.filter(isPayment);
  const paymentEntries = ledger.entries.filter((e): e is Extract<LedgerEntry, { kind: "payment" }> => e.kind === "payment");
  const latest = paymentEntries.at(-1);
  const nextDue = nextDueDate({
    recurringNext: input.item?.nextExpectedDate ?? null,
    lastPaymentDate: latest?.date ?? null,
    startDate: ledger.startDate,
    today,
  });
  const currentPayment = latest?.paidCents ?? (input.item ? Math.abs(input.item.typicalAmountCents) : null);
  const projectionInput: ProjectionInput = {
    owedCents: ledger.owedCents,
    rateThousandths: input.loan.rateThousandths,
    insurance,
    nextDueDate: nextDue,
    lastPaymentOn: input.loan.lastPaymentOn,
    currentPaymentUntil: input.loan.currentPaymentUntil,
    amortizationFrom,
    currentPaymentCents: currentPayment,
  };
  const projection = loanProjection(projectionInput);

  const allPayments = [...historyPayments, ...paymentEntries];
  const changes = new Map<string, number>();
  allPayments.forEach((entry, i) => {
    if (i > 0) changes.set(entry.transactionId, entry.paidCents - allPayments[i - 1].paidCents);
  });
  const cost = (kind: "deferral" | "estimated") =>
    history.reduce((sum, e) => (e.kind === kind ? sum + e.interestCents + e.insuranceCents : sum), 0);
  const first = ledger.startDate;

  return {
    ledger,
    owedCents: ledger.owedCents,
    repaidPercent: repaidPercent(input.loan.borrowedCents, ledger.owedCents),
    nextDue: ledger.owedCents > 0 ? nextDue : null,
    projectionInput,
    projection,
    endDate: projection.endDate ?? input.loan.lastPaymentOn,
    history,
    length: loanLength({ lastPaymentOn: input.loan.lastPaymentOn, after: startedOn ?? first, today }),
    deferralCostCents: cost("deferral"),
    estimatedCostCents: cost("estimated"),
    paidInterestAndInsuranceCents:
      allPayments.reduce((sum, e) => sum + e.interestCents + e.insuranceCents, 0) + cost("deferral") + cost("estimated"),
    changeFromPreviousCents: changes,
  };
}

type PaymentEntry = Extract<LedgerEntry, { kind: "payment" }>;
const isPayment = (e: LedgerEntry): e is PaymentEntry => e.kind === "payment";

/**
 * Everything before the first checkpoint, oldest first: the deferral (exact), then either one estimated period
 * or, when real payments reach back to it and the borrowed figure disagrees, a visible correction, then the
 * real payments replayed backwards from the capital owed.
 */
function buildHistory(input: LoanViewInput, insurance: InsuranceTerms, startedOn: string, amortizationFrom: string | null): LedgerEntry[] {
  const anchor = input.checkpoints.reduce<(typeof input.checkpoints)[number] | null>((a, c) => (a === null || c.date < a.date ? c : a), null);
  if (!anchor || startedOn >= anchor.date) return [];
  const back = backfillPayments({
    anchorOwedCents: anchor.owedCents,
    rateThousandths: input.loan.rateThousandths,
    insurance,
    payments: input.payments.filter((p) => p.date >= startedOn && p.date < anchor.date),
    splits: input.splits,
  });
  const until = back.entries[0]?.date ?? anchor.date;
  const period = {
    startedOn,
    amortizationFrom,
    lastPaymentOn: input.loan.lastPaymentOn,
    borrowedCents: input.loan.borrowedCents,
    rateThousandths: input.loan.rateThousandths,
    insurance,
    until,
    owedAtUntilCents: back.owedBeforeCents,
  };
  const deferral = deferralEntry(period);
  const estimated = estimatePeriod(period);
  const gap: LedgerEntry[] =
    estimated === null && back.owedBeforeCents !== input.loan.borrowedCents
      ? [{ kind: "correction", date: until, checkpointId: null, deltaCents: back.owedBeforeCents - input.loan.borrowedCents, owedAfterCents: back.owedBeforeCents }]
      : [];
  return [...(deferral ? [deferral] : []), ...(estimated ? [estimated] : []), ...gap, ...back.entries];
}
