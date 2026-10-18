import { daysBetween, nextExpectedDate, type RecurringInterval } from "./dates";
import { merchantKey } from "./merchant-key";

export interface RecurringTx {
  id: string;
  date: string;
  amountCents: number;
  labelNormalized: string | null;
  /** Set when the row carries a merchant name: the group then follows the name, not the label. */
  merchantId: string | null;
}

export type Sign = "out" | "in";

export interface TxGroup {
  merchantKey: string;
  sign: Sign;
  /** Sorted by date ascending, then id. */
  txs: RecurringTx[];
  /** Date of the newest transaction in the group. */
  lastSeenDate: string;
}

export interface Candidate {
  merchantKey: string;
  sign: Sign;
  interval: RecurringInterval;
  /** Signed median amount of the run, in integer cents. */
  typicalAmountCents: number;
  lastSeenDate: string;
  nextExpectedDate: string;
  transactionIds: string[];
}

/**
 * Accepted gap between two consecutive occurrences, in days, inclusive.
 * Wider than the calendar lengths because bank booking dates slip over
 * weekends and holidays.
 */
export const INTERVAL_BANDS: Record<
  RecurringInterval,
  { min: number; max: number }
> = {
  weekly: { min: 6, max: 8 },
  monthly: { min: 27, max: 33 },
  quarterly: { min: 85, max: 97 },
  yearly: { min: 355, max: 375 },
};

const MIN_OCCURRENCES = 3;
const INTERVALS = Object.keys(INTERVAL_BANDS) as RecurringInterval[];

/** Lowercase, so a merchant key can never collide with an (uppercase) label key. */
export const MERCHANT_KEY_PREFIX = "merchant:";

/** Grouping key of a row, or null when it carries no signal (no merchant and no label). */
export function txMerchantKey(tx: Pick<RecurringTx, "merchantId" | "labelNormalized">): string | null {
  if (tx.merchantId) return `${MERCHANT_KEY_PREFIX}${tx.merchantId}`;
  if (tx.labelNormalized === null || tx.labelNormalized.trim() === "") return null;
  return merchantKey(tx.labelNormalized);
}

/** The merchant id inside a `merchant:<id>` key, else null. */
export function merchantIdOfKey(key: string): string | null {
  return key.startsWith(MERCHANT_KEY_PREFIX) ? key.slice(MERCHANT_KEY_PREFIX.length) : null;
}

export function groupKey(key: string, sign: Sign): string {
  return `${sign}:${key}`;
}

function signOf(amountCents: number): Sign {
  return amountCents < 0 ? "out" : "in";
}

/**
 * Groups usable transactions by merchant key and sign. Rows without a label
 * and merchant, or with a zero amount carry no signal and are skipped.
 */
export function groupTransactions(
  txs: readonly RecurringTx[],
): Map<string, TxGroup> {
  const groups = new Map<string, TxGroup>();
  for (const tx of txs) {
    const key = txMerchantKey(tx);
    if (key === null) continue;
    if (tx.amountCents === 0) continue;
    const sign = signOf(tx.amountCents);
    const id = groupKey(key, sign);
    const group = groups.get(id);
    if (group) group.txs.push(tx);
    else
      groups.set(id, {
        merchantKey: key,
        sign,
        txs: [tx],
        lastSeenDate: tx.date,
      });
  }
  for (const group of groups.values()) {
    group.txs.sort((a, b) =>
      a.date === b.date
        ? a.id.localeCompare(b.id)
        : a.date.localeCompare(b.date),
    );
    group.lastSeenDate = group.txs[group.txs.length - 1].date;
  }
  return groups;
}

export function bandFor(gapDays: number): RecurringInterval | null {
  return (
    INTERVALS.find(
      (i) =>
        gapDays >= INTERVAL_BANDS[i].min && gapDays <= INTERVAL_BANDS[i].max,
    ) ?? null
  );
}

// Integer check for "within 10% of the reference amount".
export function isStableAmount(amountCents: number, referenceCents: number): boolean {
  return (
    Math.abs(amountCents - referenceCents) * 10 <= Math.abs(referenceCents)
  );
}

// Lower-middle for even counts keeps the result an integer and deterministic.
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function detectGroup(group: TxGroup, referenceDate: string): Candidate | null {
  const { txs } = group;
  if (txs.length < MIN_OCCURRENCES) return null;
  // Two payments on one day mean a shop, not a subscription.
  for (let i = 1; i < txs.length; i++) {
    if (txs[i].date === txs[i - 1].date) return null;
  }

  const last = txs[txs.length - 1];
  const interval = bandFor(daysBetween(txs[txs.length - 2].date, last.date));
  if (interval === null) return null;

  // Only the trailing run counts, so an old price change or missed month
  // cannot block a payment that is regular again.
  const band = INTERVAL_BANDS[interval];
  let start = txs.length - 1;
  while (start > 0) {
    const gap = daysBetween(txs[start - 1].date, txs[start].date);
    if (gap < band.min || gap > band.max) break;
    if (!isStableAmount(txs[start - 1].amountCents, last.amountCents)) break;
    start--;
  }
  const run = txs.slice(start);
  if (run.length < MIN_OCCURRENCES) return null;

  const next = nextExpectedDate(last.date, interval);
  // Two missed periods in a row: the payment has most likely ended.
  if (nextExpectedDate(next, interval) < referenceDate) return null;

  return {
    merchantKey: group.merchantKey,
    sign: group.sign,
    interval,
    typicalAmountCents: median(run.map((t) => t.amountCents)),
    lastSeenDate: last.date,
    nextExpectedDate: next,
    transactionIds: run.map((t) => t.id),
  };
}

// The (user, merchant_key) unique constraint allows one item per key.
function prefer(a: Candidate, b: Candidate): Candidate {
  if (a.transactionIds.length !== b.transactionIds.length) {
    return a.transactionIds.length > b.transactionIds.length ? a : b;
  }
  if (a.lastSeenDate !== b.lastSeenDate)
    return a.lastSeenDate > b.lastSeenDate ? a : b;
  return a.sign === "out" ? a : b;
}

/**
 * Finds recurring payments. `referenceDate` (normally the user's latest
 * transaction date) is a parameter so the function stays pure. Output is
 * sorted by merchant key.
 */
export function detectRecurring(
  txs: readonly RecurringTx[],
  referenceDate: string,
): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const group of groupTransactions(txs).values()) {
    const candidate = detectGroup(group, referenceDate);
    if (candidate === null) continue;
    const existing = best.get(candidate.merchantKey);
    best.set(
      candidate.merchantKey,
      existing ? prefer(existing, candidate) : candidate,
    );
  }
  return [...best.values()].sort((a, b) =>
    a.merchantKey < b.merchantKey ? -1 : a.merchantKey > b.merchantKey ? 1 : 0,
  );
}
