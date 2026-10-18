import { and, eq, sql } from "drizzle-orm";

import { addDays } from "../../lib/recurring/dates";
import type { db as dbClient } from "../client";
import { accounts } from "../schema";
import { deleteManualCheckpoint, upsertManualCheckpoint } from "./balance-checkpoints";
import { toCents } from "./dashboard";

type Executor = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];

export interface AccountBalance {
  id: string;
  name: string;
  /** From the manual checkpoint, shown as the balance at the START of the day after it. */
  startingBalanceCents: number | null;
  startingBalanceDate: string | null;
  thresholdCents: number;
  /** Whether the account counts toward "safe to spend". */
  inSafeToSpend: boolean;
  /** Null when there is neither a bank balance nor a manual one. */
  balanceCents: number | null;
  /** Date the balance is known up to (latest movement since the anchor, or the anchor's day). Null when unset. */
  asOf: string | null;
  /** Where the figure comes from: the bank's latest balance, the user's own, or nothing yet. */
  source: "manual" | "bank" | null;
  bankName: string | null;
  /** When franC read the bank's balance; null unless `source` is "bank". */
  fetchedAt: Date | null;
  /** The account is linked to a bank account (it may not have been synced yet). */
  connected: boolean;
}

type BalanceRow = {
  id: string;
  name: string;
  threshold: number;
  in_safe_to_spend: boolean;
  connected: boolean;
  manual_date: string | null;
  manual_amount: number | null;
  bank_date: string | null;
  bank_amount: number | null;
  bank_name: string | null;
  fetched_at: Date | string | null;
  movement: string | null;
  latest_date: string | null;
};

/**
 * Per account (oldest first): the balance from one anchor checkpoint plus the movements after it,
 * transfers included, ignored rows left out. A connected account with a bank balance is anchored on
 * its latest one and counts rows booked after its day (`coalesce(booked_on, date)`: the bank's
 * balance only holds booked rows). Any other account is anchored on its manual checkpoint (end of
 * the day before the starting date) and counts rows by `date`, as before. Scoped by user_id.
 */
export async function getAccountBalances(
  database: typeof dbClient | Executor,
  userId: string,
): Promise<AccountBalance[]> {
  const rows: BalanceRow[] = await database.execute(sql`
    select
      a.id, a.name, a.low_balance_threshold_cents as threshold, a.in_safe_to_spend,
      exists (
        select 1 from bank_account_links l where l.account_id = a.id and l.user_id = a.user_id
      ) as connected,
      m.date::text as manual_date, m.amount_cents as manual_amount,
      b.date::text as bank_date, b.amount_cents as bank_amount, b.bank_name, b.fetched_at,
      case when b.date is not null and exists (
        select 1 from bank_account_links l where l.account_id = a.id and l.user_id = a.user_id
      ) then (
        select coalesce(sum(t.amount_cents), 0)::text from transactions t
        where t.account_id = a.id and t.user_id = a.user_id and t.ignored_at is null
          and coalesce(t.booked_on, t.date) > b.date
      ) else (
        select coalesce(sum(t.amount_cents), 0)::text from transactions t
        where t.account_id = a.id and t.user_id = a.user_id and t.ignored_at is null and t.date > m.date
      ) end as movement,
      case when b.date is not null and exists (
        select 1 from bank_account_links l where l.account_id = a.id and l.user_id = a.user_id
      ) then (
        select max(coalesce(t.booked_on, t.date))::text from transactions t
        where t.account_id = a.id and t.user_id = a.user_id and t.ignored_at is null
          and coalesce(t.booked_on, t.date) > b.date
      ) else (
        select max(t.date)::text from transactions t
        where t.account_id = a.id and t.user_id = a.user_id and t.ignored_at is null and t.date > m.date
      ) end as latest_date
    from accounts a
    left join balance_checkpoints m
      on m.account_id = a.id and m.user_id = a.user_id and m.source = 'manual'
    left join lateral (
      select c.date, c.amount_cents, c.bank_name, c.fetched_at from balance_checkpoints c
      where c.account_id = a.id and c.user_id = a.user_id and c.source = 'bank'
      order by c.date desc limit 1
    ) b on true
    where a.user_id = ${userId}
    order by a.created_at asc, a.id asc
  `);

  return rows.map((r): AccountBalance => {
    const base = {
      id: r.id,
      name: r.name,
      startingBalanceCents: r.manual_amount,
      startingBalanceDate: r.manual_date === null ? null : addDays(r.manual_date, 1),
      thresholdCents: r.threshold,
      inSafeToSpend: r.in_safe_to_spend,
      connected: r.connected,
    };
    const fromBank = r.connected && r.bank_date !== null && r.bank_amount !== null;
    const anchorDate = fromBank ? r.bank_date : r.manual_date;
    const anchorAmount = fromBank ? r.bank_amount : r.manual_amount;
    if (anchorDate === null || anchorAmount === null) {
      return { ...base, balanceCents: null, asOf: null, source: null, bankName: null, fetchedAt: null };
    }
    // ISO strings compare correctly.
    const asOf = r.latest_date !== null && r.latest_date > anchorDate ? r.latest_date : anchorDate;
    return {
      ...base,
      balanceCents: anchorAmount + toCents(r.movement ?? 0),
      asOf,
      source: fromBank ? "bank" : "manual",
      bankName: fromBank ? r.bank_name : null,
      fetchedAt: fromBank && r.fetched_at !== null ? new Date(r.fetched_at) : null,
    };
  });
}

export interface AccountBalanceSettings {
  startingBalanceCents: number;
  /** "YYYY-MM-DD": the balance is the one at the START of this day. */
  startingBalanceDate: string;
  thresholdCents: number;
}

export type SetAccountBalanceResult = { ok: true } | { ok: false; error: "notFound" };

/** Sets an account's manual balance and threshold. Another user's account is "notFound". */
export async function setAccountBalance(
  database: typeof dbClient,
  userId: string,
  accountId: string,
  settings: AccountBalanceSettings,
): Promise<SetAccountBalanceResult> {
  return database.transaction(async (tx) => {
    const updated = await tx
      .update(accounts)
      .set({ lowBalanceThresholdCents: settings.thresholdCents })
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .returning({ id: accounts.id });
    if (updated.length === 0) return { ok: false, error: "notFound" } as const;
    // Start of day D is the end of the day before.
    await upsertManualCheckpoint(tx, userId, accountId, {
      date: addDays(settings.startingBalanceDate, -1),
      amountCents: settings.startingBalanceCents,
    });
    return { ok: true } as const;
  });
}

/** Removes the manual balance and resets the threshold to 0. */
export async function clearAccountBalance(
  database: typeof dbClient,
  userId: string,
  accountId: string,
): Promise<SetAccountBalanceResult> {
  return database.transaction(async (tx) => {
    const updated = await tx
      .update(accounts)
      .set({ lowBalanceThresholdCents: 0 })
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .returning({ id: accounts.id });
    if (updated.length === 0) return { ok: false, error: "notFound" } as const;
    await deleteManualCheckpoint(tx, userId, accountId);
    return { ok: true } as const;
  });
}

/** Includes or excludes an account from "safe to spend". Another user's account is "notFound". */
export async function setAccountInSafeToSpend(
  database: typeof dbClient,
  userId: string,
  accountId: string,
  inSafeToSpend: boolean,
): Promise<SetAccountBalanceResult> {
  const updated = await database
    .update(accounts)
    .set({ inSafeToSpend })
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .returning({ id: accounts.id });
  return updated.length > 0 ? { ok: true } : { ok: false, error: "notFound" };
}

/**
 * Whether the account's balance comes from the bank: it is linked and has read a bank balance.
 * Such a balance can't be edited by hand (the manual one only comes back on disconnect).
 */
export async function isBankBalanceAccount(
  database: typeof dbClient | Executor,
  userId: string,
  accountId: string,
): Promise<boolean> {
  const rows: Array<{ ok: boolean }> = await database.execute(sql`
    select (
      exists (select 1 from bank_account_links l where l.account_id = ${accountId}::uuid and l.user_id = ${userId})
      and exists (
        select 1 from balance_checkpoints c
        where c.account_id = ${accountId}::uuid and c.user_id = ${userId} and c.source = 'bank'
      )
    ) as ok
  `);
  return rows[0]?.ok === true;
}

/** Sets only the "warn me below" amount: the one balance field a bank-sourced account keeps. */
export async function setAccountThreshold(
  database: typeof dbClient,
  userId: string,
  accountId: string,
  thresholdCents: number,
): Promise<SetAccountBalanceResult> {
  const updated = await database
    .update(accounts)
    .set({ lowBalanceThresholdCents: thresholdCents })
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .returning({ id: accounts.id });
  return updated.length > 0 ? { ok: true } : { ok: false, error: "notFound" };
}

export interface DailyNet {
  accountId: string;
  /** "YYYY-MM-DD" */
  date: string;
  netCents: number;
}

/**
 * Net amount per account and day over (`from`, `to`], and the date of the earliest row of those accounts
 * (null when they have none), for rebuilding a month's balance curve backwards (see month-curve.ts).
 * Ignored rows are left out, as everywhere; the day is the operation date, as in the lists. Scoped by user_id.
 */
export async function getDailyNet(
  database: typeof dbClient | Executor,
  userId: string,
  args: { accountIds: string[]; from: string; to: string },
): Promise<{ rows: DailyNet[]; earliest: string | null }> {
  const { accountIds, from, to } = args;
  if (accountIds.length === 0) return { rows: [], earliest: null };
  const ids = sql.join(accountIds.map((id) => sql`${id}`), sql`, `);
  const [rows, earliest] = await Promise.all([
    database.execute(sql`
      select account_id, date::text as date, sum(amount_cents)::text as net
      from transactions
      where user_id = ${userId} and account_id in (${ids}) and ignored_at is null and date > ${from} and date <= ${to}
      group by account_id, date
    `),
    database.execute(sql`
      select min(date)::text as earliest from transactions
      where user_id = ${userId} and account_id in (${ids}) and ignored_at is null
    `),
  ]);
  return {
    rows: (rows as unknown as { account_id: string; date: string; net: string }[]).map((r) => ({
      accountId: r.account_id,
      date: r.date,
      netCents: toCents(r.net),
    })),
    earliest: (earliest as unknown as { earliest: string | null }[])[0]?.earliest ?? null,
  };
}
