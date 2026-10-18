import { fillTrend, type TrendPoint } from "./month";

export interface MonthHistoryRow {
  month: string;
  spentCents: number;
  incomeCents: number;
  count: number;
}

export type PickerCellState = "data" | "empty" | "future";

export interface PickerCell {
  month: string;
  spentCents: number;
  state: PickerCellState;
}

/**
 * Twelve cells for a year. The current month is always selectable, even before its first
 * import, so the picker never leaves the user without a valid target.
 */
export function buildPickerYear(year: number, history: readonly MonthHistoryRow[], currentMonth: string): PickerCell[] {
  const byMonth = new Map(history.map((r) => [r.month, r]));
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${String(year).padStart(4, "0")}-${String(i + 1).padStart(2, "0")}`;
    const row = byMonth.get(month);
    const state: PickerCellState =
      month > currentMonth ? "future" : month === currentMonth || (row !== undefined && row.count > 0) ? "data" : "empty";
    return { month, spentCents: row?.spentCents ?? 0, state };
  });
}

export function pickerYearBounds(
  history: readonly MonthHistoryRow[],
  currentMonth: string,
): { minYear: number; maxYear: number } {
  const currentYear = Number(currentMonth.slice(0, 4));
  const first = history.filter((r) => r.count > 0).reduce<string | null>((min, r) => (min === null || r.month < min ? r.month : min), null);
  const minYear = first === null ? currentYear : Math.min(Number(first.slice(0, 4)), currentYear);
  return { minYear, maxYear: Math.max(currentYear, minYear) };
}

export function latestMonthWithData(history: readonly MonthHistoryRow[]): string | null {
  return history.reduce<string | null>((max, r) => (r.count > 0 && (max === null || r.month > max) ? r.month : max), null);
}

export function trendFromHistory(history: readonly MonthHistoryRow[], months: string[]): TrendPoint[] {
  return fillTrend(
    history.map(({ month, spentCents, incomeCents }) => ({ month, spentCents, incomeCents })),
    months,
  );
}
