import { addMonths } from "../dashboard/month";

/** Own-category outflows of one month (positive cents), as the monthly spending query returns them. */
export interface MonthlySpendingRow {
  categoryId: string;
  month: string;
  spentCents: number;
}

/** categoryId -> month ("YYYY-MM") -> outflows, positive cents. */
export type SpendingByMonth = ReadonlyMap<string, ReadonlyMap<string, number>>;

/**
 * Rolls own-category spending up like budgets do (§30): a top-level category's figure is its
 * own plus its direct subcategories'; a subcategory's is its own. Categories are one level deep.
 */
export function rollUpMonthlySpending(
  rows: readonly MonthlySpendingRow[],
  parentOf: ReadonlyMap<string, string | null>,
): SpendingByMonth {
  const result = new Map<string, Map<string, number>>();
  const add = (categoryId: string, month: string, cents: number) => {
    const months = result.get(categoryId) ?? new Map<string, number>();
    months.set(month, (months.get(month) ?? 0) + cents);
    result.set(categoryId, months);
  };
  for (const row of rows) {
    add(row.categoryId, row.month, row.spentCents);
    const parentId = parentOf.get(row.categoryId);
    if (parentId) add(parentId, row.month, row.spentCents);
  }
  return result;
}

export interface RolloverSetting {
  amountCents: number;
  /** "YYYY-MM": the first month whose leftover counts. */
  startMonth: string;
  /** Carry already built before startMonth. */
  baseCents: number;
}

/**
 * What carries into `month`: the base plus, for every month from the start up to the one before
 * `month`, the budget minus that month's spending. Unspent money adds up; overspending takes
 * away and can make it negative. Null before the start month, where rollover did not apply yet.
 */
export function computeCarry(
  setting: RolloverSetting,
  spent: ReadonlyMap<string, number> | undefined,
  month: string,
): number | null {
  if (month < setting.startMonth) return null;
  let carry = setting.baseCents;
  for (let m = setting.startMonth; m < month; m = addMonths(m, 1)) {
    carry += setting.amountCents - (spent?.get(m) ?? 0);
  }
  return carry;
}

/** "YYYY-MM-DD" (a SQL date) to its "YYYY-MM". */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}
