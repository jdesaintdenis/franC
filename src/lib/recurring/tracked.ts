import { daysBetween, nextExpectedDate, type RecurringInterval } from "./dates";
import { bandFor, median } from "./detect";

/** How many recent payments a tracked item looks at. */
export const TRACKED_WINDOW = 6;

export interface TrackedFields {
  typicalAmountCents: number;
  interval: RecurringInterval;
  lastSeenDate: string;
  nextExpectedDate: string;
}

/**
 * A tracked item's fields from its payments (sorted by date ascending, non-empty, one sign).
 * Amount = lower median of the last 6; cadence = the band of the median gap between them,
 * else `fallback` (the stored interval, `monthly` at creation).
 */
export function trackedFields(
  txs: readonly { date: string; amountCents: number }[],
  fallback: RecurringInterval,
): TrackedFields {
  const recent = txs.slice(-TRACKED_WINDOW);
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) gaps.push(daysBetween(recent[i - 1].date, recent[i].date));
  const interval = gaps.length > 0 ? (bandFor(median(gaps)) ?? fallback) : fallback;
  const last = recent[recent.length - 1].date;
  return {
    typicalAmountCents: median(recent.map((t) => t.amountCents)),
    interval,
    lastSeenDate: last,
    nextExpectedDate: nextExpectedDate(last, interval),
  };
}

/** Lowest and highest of the newest 6 amounts (history is newest first); null when empty. */
export function recentRange(history: readonly { amountCents: number }[]): { min: number; max: number } | null {
  const amounts = history.slice(0, TRACKED_WINDOW).map((h) => h.amountCents);
  return amounts.length === 0 ? null : { min: Math.min(...amounts), max: Math.max(...amounts) };
}
