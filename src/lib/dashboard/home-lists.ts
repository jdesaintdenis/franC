import { chargeTotals, isChargesOnly, type ChargeTotals } from "../budgets/charges";
import type { BudgetEntry, BudgetItem, BudgetOverview } from "../budgets/progress";

/** Rows Home shows per list before linking to the full page. */
export const HOME_LIST_MAX = 4;

/**
 * The budgets Home shows. `buildBudgetOverview` already orders items (over first, then on pace to
 * go over, then the highest share used), so Home only cuts the list.
 */
export function homeBudgets(overview: BudgetOverview, max: number = HOME_LIST_MAX): { shown: BudgetItem[]; total: number } {
  const items = overview.items.filter((item) => !isChargesOnly(item, chargeTotals(item.charges ?? [])));
  return { shown: items.slice(0, max), total: items.length };
}

/** Share of the available amount used, floored and not capped (140 means 40 % over). 100 when nothing is available. */
export function budgetPercent(entry: Pick<BudgetEntry, "spentCents" | "availableCents">): number {
  return entry.availableCents <= 0 ? 100 : Math.floor((entry.spentCents * 100) / entry.availableCents);
}

/** Ten blocks, one per 10 %, plus a half block for 5 % or more of the next step. */
export function gaugeBlocks(percent: number): { full: number; half: boolean } {
  const full = Math.min(10, Math.max(0, Math.floor(percent / 10)));
  return { full, half: full < 10 && percent % 10 >= 5 };
}

/** Where today falls in the month, 0-100, for the gauge's pace tick. */
export function paceTickPercent(day: number, daysInMonth: number): number {
  return Math.round((day / daysInMonth) * 100);
}

export interface GaugeSegment {
  kind: "paid" | "other" | "due";
  /** Share of the available amount, 0-100. */
  percent: number;
}

/**
 * What fills a budget's gauge, in order: regular payments already paid, the other spending, then
 * the payments still due. Capped at 100 % in total; with nothing available the gauge is full of spending.
 */
export function gaugeSegments(entry: Pick<BudgetEntry, "availableCents" | "spentCents">, totals: ChargeTotals): GaugeSegment[] {
  if (entry.availableCents <= 0) return [{ kind: "other", percent: 100 }];
  const share = (cents: number) => (cents * 100) / entry.availableCents;
  const paid = Math.min(totals.paidCents, entry.spentCents);
  const parts: GaugeSegment[] = [
    { kind: "paid", percent: share(paid) },
    { kind: "other", percent: share(entry.spentCents - paid) },
    { kind: "due", percent: share(totals.dueCents) },
  ];
  let room = 100;
  return parts.flatMap((part) => {
    const percent = Math.min(part.percent, room);
    room -= percent;
    return percent > 0 ? [{ ...part, percent }] : [];
  });
}

/**
 * Where an even pace stands today on the part of the budget that is not regular payments: it starts
 * after the payments already paid and leaves room for the ones still due. Without payments it is
 * `paceTickPercent`.
 */
export function restPaceTickPercent(
  day: number,
  daysInMonth: number,
  entry: Pick<BudgetEntry, "availableCents">,
  totals: ChargeTotals,
): number {
  if (entry.availableCents <= 0) return paceTickPercent(day, daysInMonth);
  const share = (cents: number) => (cents * 100) / entry.availableCents;
  const paid = Math.min(100, share(totals.paidCents));
  const all = Math.min(100, share(totals.paidCents + totals.dueCents));
  return Math.min(100, Math.max(0, Math.round(paid + (day / daysInMonth) * (100 - all))));
}

export type BudgetDetail =
  | { kind: "of"; spentCents: number; availableCents: number }
  | { kind: "behind"; spentCents: number; carryCents: number }
  | { kind: "ofBehind"; spentCents: number; availableCents: number; carryCents: number };

/**
 * The "x sur y" line of a budget row. A rollover deficit is told as a delay carried over, never as a
 * negative "sur" (`carryCents` is reported positive). Without deficit it stays "x sur y".
 */
export function budgetDetail(entry: Pick<BudgetEntry, "spentCents" | "availableCents" | "carryCents">): BudgetDetail {
  const { spentCents, availableCents, carryCents } = entry;
  if (carryCents === null || carryCents >= 0) return { kind: "of", spentCents, availableCents };
  if (availableCents <= 0) return { kind: "behind", spentCents, carryCents: -carryCents };
  return { kind: "ofBehind", spentCents, availableCents, carryCents: -carryCents };
}
