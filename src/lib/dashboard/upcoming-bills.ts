import { addDays } from "../recurring/dates";
import type { SafeToSpendBill } from "../safe-to-spend/compute";
import { monthProgress } from "../safe-to-spend/per-day";
import { monthRange } from "./month";

/** A bill of 100,00 € or more is "big" (SPEC §80 C). */
export const BIG_BILL_CENTS = 10_000;
// A dot stops growing here, so one huge bill cannot swallow its neighbours.
const DOT_CAP_CENTS = 30_000;
const DOT_MIN_PX = 8;
const DOT_RANGE_PX = 14;
const BIGGEST_SHOWN = 3;

export interface StripDot {
  /** "YYYY-MM-DD", clamped to the month's first day. */
  date: string;
  /** 0 = first day of the month, 1 = last day. */
  position: number;
  /** Positive sum of the day's bills. */
  totalCents: number;
  big: boolean;
  sizePx: number;
  bills: SafeToSpendBill[];
}

export interface UpcomingBills {
  /** Positive. */
  totalCents: number;
  count: number;
  bigCount: number;
  /** Date order. */
  dots: StripDot[];
  /** Largest first, at most three. */
  biggest: SafeToSpendBill[];
  /** Today's place on the strip, 0..1. */
  todayPosition: number;
  daysInMonth: number;
}

export function isBigBill(bill: Pick<SafeToSpendBill, "amountCents">): boolean {
  return -bill.amountCents >= BIG_BILL_CENTS;
}

/** Dot diameter in px: 8 for nothing, 22 from 300 € up. */
export function dotSize(cents: number): number {
  return Math.round(DOT_MIN_PX + DOT_RANGE_PX * Math.sqrt(Math.min(cents, DOT_CAP_CENTS) / DOT_CAP_CENTS));
}

function position(day: number, daysInMonth: number): number {
  return daysInMonth > 1 ? (day - 1) / (daysInMonth - 1) : 0;
}

/** The bills still due this month as a strip (a dot per day), a total and the biggest three. */
export function buildUpcomingBills(bills: readonly SafeToSpendBill[], today: string): UpcomingBills {
  const month = today.slice(0, 7);
  const { from } = monthRange(month);
  const { day: todayDay, daysInMonth } = monthProgress(today);

  const byDate = new Map<string, SafeToSpendBill[]>();
  for (const bill of bills) {
    // A bill dated before the month (balance date in the previous month) sits on day 1.
    const date = bill.date < from ? from : bill.date;
    byDate.set(date, [...(byDate.get(date) ?? []), bill]);
  }
  const dots: StripDot[] = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, day]) => {
      const totalCents = day.reduce((sum, b) => sum - b.amountCents, 0);
      return {
        date,
        position: position(Number(date.slice(8, 10)), daysInMonth),
        totalCents,
        big: day.some(isBigBill),
        sizePx: dotSize(totalCents),
        bills: day,
      };
    });

  const biggest = [...bills]
    .sort((a, b) => a.amountCents - b.amountCents || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.name.localeCompare(b.name))
    .slice(0, BIGGEST_SHOWN);

  return {
    totalCents: bills.reduce((sum, b) => sum - b.amountCents, 0),
    count: bills.length,
    bigCount: bills.filter(isBigBill).length,
    dots,
    biggest,
    todayPosition: position(todayDay, daysInMonth),
    daysInMonth,
  };
}

/** Bills within one day of `date`, date order: what a tap on a dot names, since neighbouring dots overlap on a phone. */
export function billsNear(dots: readonly StripDot[], date: string): SafeToSpendBill[] {
  const near = new Set([addDays(date, -1), date, addDays(date, 1)]);
  return dots.filter((d) => near.has(d.date)).flatMap((d) => d.bills);
}
