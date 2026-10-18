import { monthProgress } from "./per-day";

export interface PacePoint {
  day: number;
  spentCents: number;
}

export interface PaceSeries {
  daysInMonth: number;
  today: number;
  /** Cumulative spending at the end of each day 1..today; days without spending repeat the total. */
  spent: PacePoint[];
  /** Where an even pace ends on the last day: spent so far plus what is left to spend (never below spent). */
  plannedTotalCents: number;
}

/** The hero chart's data: the month's cumulative spending up to today and the even-pace target. Pure, string dates only. */
export function buildPaceSeries(input: {
  daily: readonly { date: string; spentCents: number }[];
  today: string;
  safeCents: number;
}): PaceSeries {
  const { day: today, daysInMonth } = monthProgress(input.today);
  const month = input.today.slice(0, 7);
  const perDay = new Map<number, number>();
  for (const row of input.daily) {
    if (row.date.slice(0, 7) !== month || row.date > input.today) continue;
    const day = Number(row.date.slice(8, 10));
    perDay.set(day, (perDay.get(day) ?? 0) + row.spentCents);
  }
  const spent: PacePoint[] = [];
  let total = 0;
  for (let day = 1; day <= today; day++) {
    total += perDay.get(day) ?? 0;
    spent.push({ day, spentCents: total });
  }
  return { daysInMonth, today, spent, plannedTotalCents: total + Math.max(0, input.safeCents) };
}
