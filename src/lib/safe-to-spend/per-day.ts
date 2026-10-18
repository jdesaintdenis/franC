import { monthRange } from "../dashboard/month";

/** Day of the month (1-based) and month length, from string parts so no Date can shift the day. */
export function monthProgress(today: string): { day: number; daysInMonth: number } {
  const days = Number(monthRange(today.slice(0, 7)).to.slice(8, 10));
  return { day: Number(today.slice(8, 10)), daysInMonth: days };
}

/**
 * What can be spent each remaining day (today included) without going below zero. Floored so
 * the per-day figure never promises more than the total; null when nothing is left to spend.
 */
export function perDayCents(safeCents: number, today: string): { perDayCents: number; daysLeft: number } | null {
  if (safeCents <= 0) return null;
  const { day, daysInMonth } = monthProgress(today);
  const daysLeft = daysInMonth - day + 1;
  return { perDayCents: Math.floor(safeCents / daysLeft), daysLeft };
}

/** From the 28th on, the current month is nearly over, so next month's outlook is worth showing. */
export function showsNextMonth(today: string): boolean {
  return monthProgress(today).day >= 28;
}
