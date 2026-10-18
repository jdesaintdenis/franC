import type { RecurringListItem } from "../../db/queries/recurring";
import { monthRange } from "../dashboard/month";
import { addDays, occurrencesBetween, type RecurringInterval } from "./dates";

export interface ForecastItem {
  id: string;
  /** Recurring items are per bank account. */
  accountId: string;
  name: string;
  merchantKey: string;
  /** Signed: negative = outflow, positive = inflow. */
  amountCents: number;
  interval: RecurringInterval;
  status: "detected" | "confirmed" | "dismissed" | "ended";
  /** Projection restarts from here; see `occurrencesBetween`. */
  lastSeenDate: string;
  /** Category of the item's latest charge; lets safe-to-spend match a bill to its budget. */
  categoryId?: string | null;
  /** Tracked by the user: the amount is an estimate (median of the last payments). */
  tracked?: boolean;
}

export interface ForecastEntry extends ForecastItem {
  /** "YYYY-MM-DD" */
  date: string;
}

/**
 * Sign convention matches the dashboard's month totals
 * (`spentCents` / `incomeCents` in db/queries/dashboard.ts): both `outCents`
 * and `inCents` are non-negative magnitudes and `netCents = inCents - outCents`
 * (negative when more goes out than comes in).
 */
export interface ForecastTotals {
  outCents: number;
  inCents: number;
  netCents: number;
}

export interface ForecastSummary {
  confirmed: ForecastTotals;
  /** Confirmed + detected. */
  all: ForecastTotals;
  count: number;
  detectedCount: number;
}

export interface MonthForecast {
  month: string;
  entries: ForecastEntry[];
  summary: ForecastSummary;
}

export function toForecastItem(item: RecurringListItem): ForecastItem {
  return {
    id: item.id,
    accountId: item.accountId,
    name: item.name,
    merchantKey: item.merchantKey,
    amountCents: item.typicalAmountCents,
    interval: item.interval,
    status: item.status,
    lastSeenDate: item.lastSeenDate,
    categoryId: item.categoryId,
    tracked: item.source === "manual",
  };
}

function compareEntries(a: ForecastEntry, b: ForecastEntry): number {
  // ISO dates compare correctly as strings. Id is the final tie-break so the
  // order is deterministic.
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Items that no longer project anything: dismissed (never recurring) or ended (cancelled). */
export function isInactive(status: ForecastItem["status"]): boolean {
  return status === "dismissed" || status === "ended";
}

/** Every occurrence of every active (not dismissed or ended) item within [from, to], in date order. */
export function projectOccurrences(
  items: ForecastItem[],
  from: string,
  to: string,
): ForecastEntry[] {
  const entries: ForecastEntry[] = [];
  for (const item of items) {
    if (isInactive(item.status)) continue;
    for (const date of occurrencesBetween(item.lastSeenDate, item.interval, from, to)) {
      entries.push({ ...item, date });
    }
  }
  return entries.sort(compareEntries);
}

function totalsOf(entries: ForecastEntry[]): ForecastTotals {
  let outCents = 0;
  let inCents = 0;
  for (const e of entries) {
    if (e.amountCents < 0) outCents += -e.amountCents;
    else inCents += e.amountCents;
  }
  return { outCents, inCents, netCents: inCents - outCents };
}

export function summarizeForecast(entries: ForecastEntry[]): ForecastSummary {
  const live = entries.filter((e) => !isInactive(e.status));
  return {
    confirmed: totalsOf(live.filter((e) => e.status === "confirmed")),
    all: totalsOf(live),
    count: live.length,
    detectedCount: live.filter((e) => e.status === "detected").length,
  };
}

export function forecastMonth(items: ForecastItem[], month: string): MonthForecast {
  const { from, to } = monthRange(month);
  const entries = projectOccurrences(items, from, to);
  return { month, entries, summary: summarizeForecast(entries) };
}

/** Occurrences from `today` through `today + days` (inclusive), soonest first. */
export function comingUp(
  items: ForecastItem[],
  today: string,
  days = 30,
  limit = 5,
): ForecastEntry[] {
  return projectOccurrences(items, today, addDays(today, days)).slice(0, limit);
}
