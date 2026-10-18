/** Integer average, rounded half away from zero; exact integer math so cents never drift. */
export function monthlyAverage(totalCents: number, monthCount: number): number {
  if (monthCount <= 0) return 0;
  const abs = Math.abs(totalCents);
  let quotient = Math.floor(abs / monthCount);
  if (2 * (abs - quotient * monthCount) >= monthCount) quotient += 1;
  return totalCents < 0 ? -quotient : quotient;
}

/**
 * Indexes (ascending) of the `n` biggest non-zero values. Ties at the boundary keep the
 * earlier month, so the result never exceeds `n`.
 */
export function biggestMonths(values: readonly number[], n: number): number[] {
  return values
    .map((value, index) => ({ value, index }))
    .filter((v) => v.value !== 0)
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, n)
    .map((v) => v.index)
    .sort((a, b) => a - b);
}

export interface CategoryMonthInput {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string | null;
  /** "YYYY-MM" */
  month: string;
  spentCents: number;
}

export interface CategoryMatrixRow {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string | null;
  /** 12 entries, January first. */
  byMonth: number[];
  totalCents: number;
  averageCents: number;
  biggestMonthIndexes: number[];
}

export interface CategoryMatrix {
  rows: CategoryMatrixRow[];
  totals: { byMonth: number[]; totalCents: number; averageCents: number; biggestMonthIndexes: number[] };
}

const TOTALS_HIGHLIGHT_COUNT = 3;

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * A row's peak month(s) are only worth highlighting when there is something to compare
 * against, i.e. spending in at least two months.
 */
function rowPeaks(byMonth: readonly number[]): number[] {
  if (byMonth.filter((v) => v !== 0).length < 2) return [];
  const max = Math.max(...byMonth);
  return byMonth.flatMap((v, i) => (v === max ? [i] : []));
}

export function buildCategoryMatrix(
  input: readonly CategoryMonthInput[],
  months: readonly string[],
  coveredMonths: readonly string[],
): CategoryMatrix {
  const byCategory = new Map<string, CategoryMatrixRow>();
  // Rows outside the year's 12 months are ignored so a stray month can't land in the wrong column.
  for (const r of input) {
    if (!months.includes(r.month)) continue;
    const key = r.categoryId ?? "";
    let row = byCategory.get(key);
    if (!row) {
      row = {
        categoryId: r.categoryId,
        name: r.name,
        color: r.color,
        icon: r.icon,
        byMonth: Array<number>(12).fill(0),
        totalCents: 0,
        averageCents: 0,
        biggestMonthIndexes: [],
      };
      byCategory.set(key, row);
    }
    row.byMonth[months.indexOf(r.month)] += r.spentCents;
  }

  const rows = [...byCategory.values()];
  for (const row of rows) {
    row.totalCents = sum(row.byMonth);
    row.averageCents = monthlyAverage(row.totalCents, coveredMonths.length);
    row.biggestMonthIndexes = rowPeaks(row.byMonth);
  }
  rows.sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name));

  const totalsByMonth = Array.from({ length: 12 }, (_, i) => sum(rows.map((r) => r.byMonth[i])));
  const totalCents = sum(totalsByMonth);
  return {
    rows,
    totals: {
      byMonth: totalsByMonth,
      totalCents,
      averageCents: monthlyAverage(totalCents, coveredMonths.length),
      biggestMonthIndexes: biggestMonths(totalsByMonth, TOTALS_HIGHLIGHT_COUNT),
    },
  };
}
