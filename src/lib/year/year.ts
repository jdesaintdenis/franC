const YEAR_RE = /^\d{4}$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** Never throws: anything that is not a single 4-digit year in range yields the fallback. */
export function parseYearParam(value: string | string[] | undefined, fallback: number): number {
  if (typeof value !== "string" || !YEAR_RE.test(value)) return fallback;
  const year = Number(value);
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : fallback;
}

/** "YYYY-01" .. "YYYY-12". */
export function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${String(year).padStart(4, "0")}-${String(i + 1).padStart(2, "0")}`);
}

/** Inclusive first and last day of the calendar year. */
export function yearRange(year: number): { from: string; to: string } {
  const y = String(year).padStart(4, "0");
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

// "YYYY-MM" strings of the same width compare correctly as text.
export function isFutureMonth(month: string, currentMonth: string): boolean {
  return month > currentMonth;
}

/**
 * The months an average over the year should divide by: from the first month with data
 * to December, or to the current month in the current year, so a half-finished or
 * partly-imported year is not diluted by empty months. Empty when there is no data or
 * the whole year lies in the future.
 */
export function monthsCovered(year: number, firstMonthWithData: string | null, currentMonth: string): string[] {
  if (!firstMonthWithData) return [];
  return monthsOfYear(year).filter(
    (month) => month >= firstMonthWithData && !isFutureMonth(month, currentMonth),
  );
}
