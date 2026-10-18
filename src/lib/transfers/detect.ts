import { daysBetween } from "../recurring/dates";

/** Automatic pairing: the two legs may be booked up to this many days apart. */
export const TRANSFER_WINDOW_DAYS = 4;
/** Candidates offered when linking by hand. */
export const CANDIDATE_WINDOW_DAYS = 7;

/** The bank's own tag for internal transfers, compared as stored. */
export const BANK_INTERNAL_TRANSFER_SUBCATEGORY = "Virement interne";

export interface TransferRow {
  id: string;
  accountId: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Integer cents; negative = outflow. */
  amountCents: number;
  bankSubcategory: string | null;
}

export interface RejectedPair {
  outTransactionId: string;
  inTransactionId: string;
}

export interface DetectedTransfer {
  outTransactionId: string;
  inTransactionId: string;
  status: "detected" | "confirmed";
}

/** Absolute day distance between two ISO dates, by string arithmetic. */
export function dayGap(a: string, b: string): number {
  return Math.abs(daysBetween(a, b));
}

/**
 * Pairs unpaired outflows with inflows of exactly the same absolute amount on a
 * different account, at most TRANSFER_WINDOW_DAYS apart, skipping rejected pairs.
 * One-to-one and greedy: smallest gap first, then earliest date, then ids, so the
 * result is deterministic and identical transfers pair in date order.
 * A pair is `confirmed` when either row carries the bank's "Virement interne" tag.
 */
export function detectTransfers(rows: readonly TransferRow[], rejected: readonly RejectedPair[]): DetectedTransfer[] {
  const rejectedKeys = new Set(rejected.map((r) => `${r.outTransactionId}:${r.inTransactionId}`));
  const inflowsByAmount = new Map<number, TransferRow[]>();
  for (const row of rows) {
    if (row.amountCents <= 0) continue;
    const list = inflowsByAmount.get(row.amountCents);
    if (list) list.push(row);
    else inflowsByAmount.set(row.amountCents, [row]);
  }

  interface Candidate {
    out: TransferRow;
    inn: TransferRow;
    gap: number;
  }
  const candidates: Candidate[] = [];
  for (const out of rows) {
    if (out.amountCents >= 0) continue;
    for (const inn of inflowsByAmount.get(-out.amountCents) ?? []) {
      if (inn.accountId === out.accountId) continue;
      const gap = dayGap(out.date, inn.date);
      if (gap > TRANSFER_WINDOW_DAYS) continue;
      if (rejectedKeys.has(`${out.id}:${inn.id}`)) continue;
      candidates.push({ out, inn, gap });
    }
  }

  const earliest = (c: Candidate) => (c.out.date < c.inn.date ? c.out.date : c.inn.date);
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  candidates.sort(
    (x, y) =>
      x.gap - y.gap ||
      compare(earliest(x), earliest(y)) ||
      compare(x.out.id, y.out.id) ||
      compare(x.inn.id, y.inn.id),
  );

  const used = new Set<string>();
  const pairs: DetectedTransfer[] = [];
  for (const { out, inn } of candidates) {
    if (used.has(out.id) || used.has(inn.id)) continue;
    used.add(out.id);
    used.add(inn.id);
    const tagged =
      out.bankSubcategory === BANK_INTERNAL_TRANSFER_SUBCATEGORY ||
      inn.bankSubcategory === BANK_INTERNAL_TRANSFER_SUBCATEGORY;
    pairs.push({ outTransactionId: out.id, inTransactionId: inn.id, status: tagged ? "confirmed" : "detected" });
  }
  return pairs;
}
