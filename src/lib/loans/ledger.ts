import { monthlyInsurance, monthlyInterest, type InsuranceTerms } from "./calc";

export interface LedgerPayment {
  transactionId: string;
  date: string;
  /** As stored: negative. */
  amountCents: number;
}

export interface LedgerCheckpoint {
  date: string;
  owedCents: number;
}

export interface PaymentSplit {
  interestCents: number;
  insuranceCents: number;
}

export type LedgerEntry =
  | {
      kind: "payment";
      transactionId: string;
      date: string;
      paidCents: number;
      interestCents: number;
      insuranceCents: number;
      capitalCents: number;
      owedAfterCents: number;
      /** The user set the interest and insurance of this payment themselves. */
      corrected: boolean;
    }
  | { kind: "correction"; date: string; checkpointId: string | null; deltaCents: number; owedAfterCents: number }
  // History before the first checkpoint (Slice 68), one row each: never a month-by-month guess.
  | { kind: "deferral"; from: string; to: string; months: number; interestCents: number; insuranceCents: number; owedAfterCents: number }
  | {
      kind: "estimated";
      from: string;
      to: string;
      months: number;
      capitalCents: number;
      interestCents: number;
      insuranceCents: number;
      owedAfterCents: number;
    };

export interface Ledger {
  entries: LedgerEntry[];
  owedCents: number;
  startDate: string;
}

/**
 * Replays a loan from its first checkpoint: every payment the bank took splits into interest, insurance and
 * capital, and a later checkpoint resets the capital owed (a correction).
 *
 * Interest and insurance are charged once per calendar month, on the first payment of that month; a second
 * payment the same month is all capital (an extra repayment). A payment the user corrected keeps their split.
 * Capital is what is left of the payment: it can be negative (the payment didn't cover the interest) and the
 * capital owed never goes below 0. Payments before the first checkpoint are ignored.
 */
export function loanLedger(input: {
  checkpoints: ReadonlyArray<LedgerCheckpoint & { id?: string }>;
  rateThousandths: number;
  insurance: InsuranceTerms;
  payments: ReadonlyArray<LedgerPayment>;
  splits: ReadonlyMap<string, PaymentSplit>;
}): Ledger {
  const checkpoints = [...input.checkpoints].sort((a, b) => a.date.localeCompare(b.date));
  const [start, ...corrections] = checkpoints;
  if (!start) return { entries: [], owedCents: 0, startDate: "" };

  type Event =
    | { kind: "checkpoint"; date: string; order: 0; id: string | null; owedCents: number }
    | { kind: "payment"; date: string; order: 1; payment: LedgerPayment };
  const events: Event[] = [
    ...corrections.map((c): Event => ({ kind: "checkpoint", date: c.date, order: 0, id: c.id ?? null, owedCents: c.owedCents })),
    ...input.payments
      .filter((p) => p.date >= start.date && p.amountCents < 0)
      .map((p): Event => ({ kind: "payment", date: p.date, order: 1, payment: p })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || tieBreak(a, b));

  let owed = start.owedCents;
  let chargedMonth = "";
  const entries: LedgerEntry[] = [];
  for (const event of events) {
    if (event.kind === "checkpoint") {
      entries.push({ kind: "correction", date: event.date, checkpointId: event.id, deltaCents: event.owedCents - owed, owedAfterCents: event.owedCents });
      owed = event.owedCents;
      continue;
    }
    const paid = -event.payment.amountCents;
    const month = event.date.slice(0, 7);
    const split = input.splits.get(event.payment.transactionId);
    let interest = 0;
    let insurance = 0;
    if (split) {
      interest = split.interestCents;
      insurance = split.insuranceCents;
      chargedMonth = month;
    } else if (month !== chargedMonth) {
      interest = monthlyInterest(owed, input.rateThousandths);
      insurance = monthlyInsurance(owed, input.insurance);
      chargedMonth = month;
    }
    const capital = Math.min(paid - interest - insurance, owed);
    owed = Math.max(0, owed - capital);
    entries.push({
      kind: "payment",
      transactionId: event.payment.transactionId,
      date: event.date,
      paidCents: paid,
      interestCents: interest,
      insuranceCents: insurance,
      capitalCents: capital,
      owedAfterCents: owed,
      corrected: split !== undefined,
    });
  }
  return { entries, owedCents: owed, startDate: start.date };
}

// Same-day payments keep a stable order whatever the query returned.
function tieBreak(a: { kind: string; payment?: LedgerPayment }, b: { kind: string; payment?: LedgerPayment }): number {
  return (a.payment?.transactionId ?? "").localeCompare(b.payment?.transactionId ?? "");
}
