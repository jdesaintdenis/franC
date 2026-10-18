import { addMonths } from "../dashboard/month";

export const PRESET_MONTHS = 3;

export interface BudgetPresets {
  /** Last full month's spending, rounded up to the euro; 0 when nothing was spent. */
  lastMonthCents: number;
  /** Average of the last 3 full months, rounded up to the euro; 0 when nothing was spent. */
  averageCents: number;
}

// Integer ceiling of a / b for a >= 0, b > 0.
function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b);
}

/**
 * One-click budget amounts from past spending. Budgets keep no history, so "same as last
 * month" means last month's spending. When the data starts less than 3 months back, the
 * average divides by the months that have data, so a new user doesn't get a third of reality.
 */
export function presetsFrom(
  spent: ReadonlyMap<string, number> | undefined,
  currentMonth: string,
  firstDataMonth: string | null,
): BudgetPresets {
  if (firstDataMonth === null) return { lastMonthCents: 0, averageCents: 0 };
  const lastMonth = addMonths(currentMonth, -1);
  let total = 0;
  let months = 0;
  for (let i = 1; i <= PRESET_MONTHS; i++) {
    const m = addMonths(currentMonth, -i);
    if (m < firstDataMonth) break;
    total += spent?.get(m) ?? 0;
    months += 1;
  }
  const last = spent?.get(lastMonth) ?? 0;
  return {
    lastMonthCents: ceilDiv(last, 100) * 100,
    averageCents: months === 0 ? 0 : ceilDiv(total, months * 100) * 100,
  };
}
