import { daysInMonth } from "../transactions/filters";

export type RecurringInterval = "weekly" | "monthly" | "quarterly" | "yearly";

const MS_PER_DAY = 86_400_000;

function parse(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

// UTC epoch days: no local time zone, so DST can never shift the result.
function toEpochDay(date: string): number {
  const { year, month, day } = parse(date);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromEpochDay(epochDay: number): string {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  return toEpochDay(b) - toEpochDay(a);
}

export function addDays(date: string, days: number): string {
  return fromEpochDay(toEpochDay(date) + days);
}

/** Keeps the day of month, clamped to the target month's last day. */
export function addMonthsClamped(date: string, months: number): string {
  const { year, month, day } = parse(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return [
    String(targetYear).padStart(4, "0"),
    String(targetMonth).padStart(2, "0"),
    String(targetDay).padStart(2, "0"),
  ].join("-");
}

export function nextExpectedDate(
  last: string,
  interval: RecurringInterval,
): string {
  switch (interval) {
    case "weekly":
      return addDays(last, 7);
    case "monthly":
      return addMonthsClamped(last, 1);
    case "quarterly":
      return addMonthsClamped(last, 3);
    case "yearly":
      return addMonthsClamped(last, 12);
  }
}

const MONTHS_PER_STEP = { monthly: 1, quarterly: 3, yearly: 12 } as const;

function monthIndex(date: string): number {
  const { year, month } = parse(date);
  return year * 12 + (month - 1);
}

/** The k-th occurrence after `last`, computed from `last` directly (see `occurrencesBetween`). */
export function nthOccurrence(last: string, interval: RecurringInterval, k: number): string {
  return interval === "weekly" ? addDays(last, 7 * k) : addMonthsClamped(last, MONTHS_PER_STEP[interval] * k);
}

/**
 * Projected occurrences strictly after `last`, within [from, to] inclusive,
 * ascending. Each is `last + k * interval` computed from `last` directly, not
 * by repeated stepping: clamping is lossy, so stepping from Jan 31 would stay
 * on the 28th after February instead of returning to the 31st.
 */
export function occurrencesBetween(
  last: string,
  interval: RecurringInterval,
  from: string,
  to: string,
): string[] {
  // Jump close to the window so an item overdue by years stays cheap. The
  // largest k whose date is on or before `from` is a safe start: every
  // smaller k lands earlier still.
  const startK =
    interval === "weekly"
      ? Math.floor(daysBetween(last, from) / 7)
      : Math.floor((monthIndex(from) - monthIndex(last)) / MONTHS_PER_STEP[interval]);

  const result: string[] = [];
  for (let k = Math.max(1, startK); ; k++) {
    const date = nthOccurrence(last, interval, k);
    // ISO dates compare correctly as strings.
    if (date > to) break;
    if (date >= from) result.push(date);
  }
  return result;
}
