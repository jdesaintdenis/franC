import { and, eq, sql } from "drizzle-orm";

import { findBalanceGap, type BalanceGap, type GapCheckpoint } from "../../lib/balance/gaps";
import type { db as dbClient } from "../client";
import { balanceCheckpoints } from "../schema";
import { toCents } from "./dashboard";

type Executor = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];
type Database = typeof dbClient | Executor;

// Every query here is scoped by userId.

export interface AccountBalanceGap {
  accountId: string;
  accountName: string;
  gap: BalanceGap;
}

type CheckpointRow = GapCheckpoint & { accountId: string };

/** Checkpoints of the user's connected accounts that have at least one bank checkpoint. */
async function loadCheckpoints(database: Database, userId: string, accountId?: string): Promise<CheckpointRow[]> {
  const rows = await database
    .select({
      id: balanceCheckpoints.id,
      accountId: balanceCheckpoints.accountId,
      date: balanceCheckpoints.date,
      amountCents: balanceCheckpoints.amountCents,
      source: balanceCheckpoints.source,
      acceptedGapCents: balanceCheckpoints.acceptedGapCents,
    })
    .from(balanceCheckpoints)
    .where(
      and(
        eq(balanceCheckpoints.userId, userId),
        accountId ? eq(balanceCheckpoints.accountId, accountId) : undefined,
        sql`exists (select 1 from bank_account_links l
          where l.account_id = ${balanceCheckpoints.accountId} and l.user_id = ${balanceCheckpoints.userId})`,
      ),
    );
  const withBank = new Set(rows.filter((r) => r.source === "bank").map((r) => r.accountId));
  return rows.filter((r) => withBank.has(r.accountId));
}

/** Non-ignored movement per account and booking day (`coalesce(booked_on, date)`). */
async function loadMovements(
  database: Database,
  userId: string,
  accountIds: readonly string[],
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (accountIds.length === 0) return out;
  const rows: Array<{ account_id: string; day: string; total: string }> = await database.execute(sql`
    select t.account_id, coalesce(t.booked_on, t.date)::text as day, sum(t.amount_cents)::text as total
    from transactions t
    -- Rows added by hand that the bank hasn't booked yet are not part of its balance.
    where t.user_id = ${userId} and t.ignored_at is null and not t.awaiting_bank
      and t.account_id in (${sql.join(accountIds.map((id) => sql`${id}::uuid`), sql`, `)})
    group by t.account_id, coalesce(t.booked_on, t.date)
  `);
  for (const r of rows) {
    const days = out.get(r.account_id) ?? new Map<string, number>();
    days.set(r.day, toCents(r.total));
    out.set(r.account_id, days);
  }
  return out;
}

/** Per connected account whose transactions don't add up to the bank's balances (accounts without a gap are left out). */
export async function getBalanceGaps(database: Database, userId: string): Promise<AccountBalanceGap[]> {
  const checkpoints = await loadCheckpoints(database, userId);
  const byAccount = new Map<string, CheckpointRow[]>();
  for (const c of checkpoints) byAccount.set(c.accountId, [...(byAccount.get(c.accountId) ?? []), c]);
  if (byAccount.size === 0) return [];

  const names: Array<{ id: string; name: string }> = await database.execute(sql`
    select id, name from accounts where user_id = ${userId} order by created_at asc, id asc
  `);
  const movements = await loadMovements(database, userId, [...byAccount.keys()]);
  const out: AccountBalanceGap[] = [];
  for (const { id, name } of names) {
    const own = byAccount.get(id);
    if (!own) continue;
    const gap = findBalanceGap(own, movements.get(id) ?? new Map());
    if (gap) out.push({ accountId: id, accountName: name, gap });
  }
  return out;
}

export type AcceptBalanceGapResult =
  | { ok: true; checkpointId: string; /** For Undo: pass it to `restoreBalanceGap`. */ previousCents: number }
  | { ok: false; error: "notFound" };

/**
 * "Accept the bank's balance": records the current difference on the latest bank checkpoint so the
 * gap reads 0. Not a transaction: spending totals don't move. Another user's account, or one without
 * a bank checkpoint, is "notFound". With no gap to accept, nothing changes.
 */
export async function acceptBalanceGap(
  database: typeof dbClient,
  userId: string,
  accountId: string,
): Promise<AcceptBalanceGapResult> {
  return database.transaction(async (tx) => {
    const checkpoints = await loadCheckpoints(tx, userId, accountId);
    const latest = checkpoints
      .filter((c) => c.source === "bank")
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (!latest) return { ok: false, error: "notFound" } as const;
    const movements = (await loadMovements(tx, userId, [accountId])).get(accountId) ?? new Map<string, number>();
    const gap = findBalanceGap(checkpoints, movements);
    if (!gap) return { ok: true, checkpointId: latest.id, previousCents: latest.acceptedGapCents } as const;
    await tx
      .update(balanceCheckpoints)
      .set({ acceptedGapCents: latest.acceptedGapCents + gap.amountCents })
      .where(and(eq(balanceCheckpoints.id, latest.id), eq(balanceCheckpoints.userId, userId)));
    return { ok: true, checkpointId: latest.id, previousCents: latest.acceptedGapCents } as const;
  });
}

/** Undo of `acceptBalanceGap`: puts back the accepted amount the checkpoint had before. */
export async function restoreBalanceGap(
  database: typeof dbClient,
  userId: string,
  checkpointId: string,
  previousCents: number,
): Promise<{ ok: true } | { ok: false; error: "notFound" }> {
  const updated = await database
    .update(balanceCheckpoints)
    .set({ acceptedGapCents: previousCents })
    .where(
      and(
        eq(balanceCheckpoints.id, checkpointId),
        eq(balanceCheckpoints.userId, userId),
        eq(balanceCheckpoints.source, "bank"),
      ),
    )
    .returning({ id: balanceCheckpoints.id });
  return updated.length > 0 ? { ok: true } : { ok: false, error: "notFound" };
}
