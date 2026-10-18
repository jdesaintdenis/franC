import { addDays, daysBetween } from "../recurring/dates";
import { projectOccurrences, type ForecastEntry, type ForecastItem } from "../recurring/forecast";

export interface BalancePoint {
  /** "YYYY-MM-DD" */
  date: string;
  /** End-of-day balance in cents. */
  balanceCents: number;
  /** Projected recurring entries of that day (possibly empty). */
  entries: ForecastEntry[];
}

export interface AccountBalanceInput {
  accountId: string;
  name: string;
  /** Balance at the end of `asOf`. */
  balanceCents: number;
  /** Date of the account's latest known transaction (see getAccountBalances). */
  asOf: string;
  /** Warn when the balance goes strictly below this. */
  thresholdCents: number;
}

export interface LowestPoint {
  date: string;
  balanceCents: number;
}

export interface BalanceBreach {
  date: string;
  balanceCents: number;
  /** True when the balance is already below the threshold at `asOf`; `cause` is then null. */
  alreadyBelow: boolean;
  /** Largest outflow of the breach day (first in entry order on ties). */
  cause: ForecastEntry | null;
  /** Other outflows of the breach day. */
  otherCount: number;
}

export interface AccountBalanceOverview {
  accountId: string;
  name: string;
  balanceCents: number;
  asOf: string;
  thresholdCents: number;
  /** One point per day from asOf + 1 to today + days; empty when asOf is already past that. */
  series: BalancePoint[];
  lowest: LowestPoint;
  breach: BalanceBreach | null;
  /** Entries dated before `today`: expected since the last import but not yet seen. */
  sinceLastImport: ForecastEntry[];
}

export interface TotalBalanceOverview {
  balanceCents: number;
  /** Combined series from min(asOf) + 1 to today + days. */
  series: { date: string; balanceCents: number }[];
  lowest: LowestPoint;
}

export interface BalanceOverview {
  accounts: AccountBalanceOverview[];
  total: TotalBalanceOverview;
}

/** End-of-day balances from `asOf + 1` through `to`, starting from the balance at the end of `asOf`. */
export function projectBalance(args: {
  balanceCents: number;
  asOf: string;
  entries: ForecastEntry[];
  to: string;
}): BalancePoint[] {
  const { balanceCents, asOf, entries, to } = args;
  const days = daysBetween(asOf, to);
  if (days <= 0) return [];

  const byDate = new Map<string, ForecastEntry[]>();
  for (const entry of entries) {
    if (entry.date <= asOf || entry.date > to) continue;
    const list = byDate.get(entry.date);
    if (list) list.push(entry);
    else byDate.set(entry.date, [entry]);
  }

  const series: BalancePoint[] = [];
  let running = balanceCents;
  for (let i = 1; i <= days; i++) {
    const date = addDays(asOf, i);
    const dayEntries = byDate.get(date) ?? [];
    for (const e of dayEntries) running += e.amountCents;
    series.push({ date, balanceCents: running, entries: dayEntries });
  }
  return series;
}

/** Earliest day with the minimum balance; `fallback` (the current balance) counts too. */
export function lowestPoint(
  series: { date: string; balanceCents: number }[],
  fallback: LowestPoint,
): LowestPoint {
  let best: LowestPoint = { date: fallback.date, balanceCents: fallback.balanceCents };
  for (const p of series) {
    if (p.balanceCents < best.balanceCents) best = { date: p.date, balanceCents: p.balanceCents };
  }
  return best;
}

/** First day the balance is strictly below the threshold, or null. */
export function firstBreach(
  series: BalancePoint[],
  thresholdCents: number,
  current?: { date: string; balanceCents: number },
): BalanceBreach | null {
  if (current && current.balanceCents < thresholdCents) {
    return { date: current.date, balanceCents: current.balanceCents, alreadyBelow: true, cause: null, otherCount: 0 };
  }
  for (const point of series) {
    if (point.balanceCents >= thresholdCents) continue;
    const outflows = point.entries.filter((e) => e.amountCents < 0);
    let cause: ForecastEntry | null = null;
    for (const e of outflows) {
      if (cause === null || e.amountCents < cause.amountCents) cause = e;
    }
    return {
      date: point.date,
      balanceCents: point.balanceCents,
      alreadyBelow: false,
      cause,
      otherCount: cause === null ? 0 : outflows.length - 1,
    };
  }
  return null;
}

/**
 * Total per day from `from` to `to` inclusive. An account contributes its balance
 * at `asOf` for days up to `asOf` and carries its last projected value forward.
 */
export function combineSeries(
  accounts: { balanceCents: number; asOf: string; series: { date: string; balanceCents: number }[] }[],
  from: string,
  to: string,
): { date: string; balanceCents: number }[] {
  const days = daysBetween(from, to);
  if (days < 0) return [];
  const lookups = accounts.map((a) => ({
    ...a,
    byDate: new Map(a.series.map((p) => [p.date, p.balanceCents])),
  }));
  const last = lookups.map((a) => a.balanceCents);
  const result: { date: string; balanceCents: number }[] = [];
  for (let i = 0; i <= days; i++) {
    const date = addDays(from, i);
    let total = 0;
    lookups.forEach((a, idx) => {
      const value = a.byDate.get(date);
      if (value !== undefined) last[idx] = value;
      // Before its window an account still shows its balance at asOf.
      total += last[idx];
    });
    result.push({ date, balanceCents: total });
  }
  return result;
}

export function buildBalanceOverview(args: {
  accounts: AccountBalanceInput[];
  items: ForecastItem[];
  today: string;
  days?: number;
}): BalanceOverview {
  const { accounts, items, today, days = 30 } = args;
  const to = addDays(today, days);

  const perAccount = accounts.map((account): AccountBalanceOverview => {
    const mine = items.filter((i) => i.accountId === account.accountId);
    const entries = projectOccurrences(mine, addDays(account.asOf, 1), to);
    const series = projectBalance({ balanceCents: account.balanceCents, asOf: account.asOf, entries, to });
    const current = { date: account.asOf, balanceCents: account.balanceCents };
    return {
      accountId: account.accountId,
      name: account.name,
      balanceCents: account.balanceCents,
      asOf: account.asOf,
      thresholdCents: account.thresholdCents,
      series,
      lowest: lowestPoint(series, current),
      breach: firstBreach(series, account.thresholdCents, current),
      sinceLastImport: entries.filter((e) => e.date < today),
    };
  });

  const balanceCents = accounts.reduce((sum, a) => sum + a.balanceCents, 0);
  const earliest = accounts.reduce((min, a) => (a.asOf < min ? a.asOf : min), today);
  const series = combineSeries(perAccount, addDays(earliest, 1), to);
  return {
    accounts: perAccount,
    total: {
      balanceCents,
      series,
      // With no accounts the total is 0 today.
      lowest: lowestPoint(series, { date: earliest, balanceCents }),
    },
  };
}
