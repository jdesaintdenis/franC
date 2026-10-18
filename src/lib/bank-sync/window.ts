import { addDays } from "../recurring/dates";

/** 90 days of history including today: what a bank must give without a fresh strong authentication. */
export const HISTORY_DAYS = 90;
/** A later sync re-reads this many days before the last sync: banks can book late. */
export const RESYNC_LOOKBACK_DAYS = 7;
/**
 * Extra days asked before the start date: a card payment made before it can be booked after it.
 * Duplicates are caught by the matcher (match.ts): bank id, dedupe hash, then same amount within a few days.
 */
export const OVERLAP_DAYS = 4;

// ISO dates compare correctly as strings.
function clamp(date: string, min: string, max: string): string {
  if (date < min) return min;
  return date > max ? max : date;
}

/** Earliest start date allowed: today - 89. */
export function earliestSyncFrom(today: string): string {
  return addDays(today, -(HISTORY_DAYS - 1));
}

/** A user-chosen start date clamped to [earliestSyncFrom(today), today]. */
export function clampSyncFrom(today: string, date: string): string {
  return clamp(date, earliestSyncFrom(today), today);
}

/** Default start: the day after the newest transaction (null, an empty account, starts at the earliest allowed). */
export function defaultSyncFrom(today: string, newestTransactionDate: string | null): string {
  if (newestTransactionDate === null) return earliestSyncFrom(today);
  return clampSyncFrom(today, addDays(newestTransactionDate, 1));
}

/**
 * The one start date a bank connection shares across its accounts: the earliest default.
 * Overlap costs nothing (sync and CSV both dedupe against existing rows), a later date would lose days.
 */
export function sharedSyncFrom(defaults: readonly string[], fallback: string): string {
  return defaults.reduce((min, d) => (d < min ? d : min), defaults[0] ?? fallback);
}

/**
 * `date_from` to ask the bank for. The first sync starts at the chosen date; later ones re-read the
 * last week (late bookings) unless the chosen date is later. Both go back by the overlap, and never
 * beyond the bank's history window nor past today.
 */
export function fetchFrom(input: { today: string; syncFrom: string; lastSyncedOn: string | null }): string {
  const { today, syncFrom, lastSyncedOn } = input;
  const start =
    lastSyncedOn === null
      ? syncFrom
      : // The newer of the two: re-reading before the chosen date would just be dropped as overlap.
        [syncFrom, addDays(lastSyncedOn, -RESYNC_LOOKBACK_DAYS)].reduce((a, b) => (a > b ? a : b));
  return clamp(addDays(start, -OVERLAP_DAYS), earliestSyncFrom(today), today);
}
