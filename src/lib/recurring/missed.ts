import { addDays, nthOccurrence, type RecurringInterval } from "./dates";

/**
 * Days a charge may come late before it counts as missed: the detection band's slack
 * above the nominal interval (see INTERVAL_BANDS), rounded up for longer intervals.
 */
export const MISSED_GRACE_DAYS: Record<RecurringInterval, number> = {
  weekly: 2,
  monthly: 3,
  quarterly: 7,
  yearly: 10,
};

/** Charges needed before a confirmed item is flagged "Cancelled?". */
export const CANCELLED_AFTER_MISSED = 2;

/**
 * Expected charges after `lastSeenDate` that never came, as of `referenceDate` (the
 * account's latest imported transaction, not today: franC only knows what was imported).
 * Occurrence k is `last + k·interval` computed directly, like the forecast, and counts
 * once the reference date is past it by more than the grace period.
 */
export function missedCycles(lastSeenDate: string, interval: RecurringInterval, referenceDate: string): number {
  let missed = 0;
  // ISO dates compare correctly as strings.
  while (addDays(nthOccurrence(lastSeenDate, interval, missed + 1), MISSED_GRACE_DAYS[interval]) < referenceDate) missed++;
  return missed;
}

export interface CancelledCheck {
  status: string;
  interval: RecurringInterval;
  lastSeenDate: string;
  /** Latest transaction date on the item's account; null when it has none. */
  accountLatestDate: string | null;
  stillActiveAt: string | null;
}

/**
 * A confirmed item is flagged "Cancelled?" after missing two charges. Answering
 * "Still active" hides the flag until at least one more charge is missed after the answer.
 */
export function isPossiblyCancelled(item: CancelledCheck): boolean {
  if (item.status !== "confirmed" || item.accountLatestDate === null) return false;
  const missed = missedCycles(item.lastSeenDate, item.interval, item.accountLatestDate);
  if (missed < CANCELLED_AFTER_MISSED) return false;
  if (item.stillActiveAt === null) return true;
  return missed > missedCycles(item.lastSeenDate, item.interval, item.stillActiveAt);
}
