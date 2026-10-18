import { and, desc, eq, gt, isNotNull, ne, sql } from "drizzle-orm";

import type { SyncStore } from "../../lib/bank-sync/sync";
import type { db as dbClient } from "../client";
import { bankAccountLinks, bankConnections, transactions, users } from "../schema";
import { saveBankCheckpoint } from "./balance-checkpoints";
import { commitImport } from "./imports";

// Every query here is scoped by userId.

/** Sync now's persistence, over Drizzle. */
export function bankSyncStore(database: typeof dbClient): SyncStore {
  return {
    async findLink(userId, linkId) {
      const [row] = await database
        .select({
          accountId: bankAccountLinks.accountId,
          bankAccountUid: bankAccountLinks.bankAccountUid,
          bankName: bankConnections.aspspName,
          syncFrom: bankAccountLinks.syncFrom,
          lastSyncedAt: bankAccountLinks.lastSyncedAt,
        })
        .from(bankAccountLinks)
        .innerJoin(bankConnections, eq(bankConnections.id, bankAccountLinks.connectionId))
        .where(
          and(
            eq(bankAccountLinks.id, linkId),
            eq(bankAccountLinks.userId, userId),
            eq(bankConnections.userId, userId),
            eq(bankConnections.status, "active"),
            isNotNull(bankAccountLinks.linkedAt),
          ),
        )
        .limit(1);
      if (!row?.accountId) return null;
      return { ...row, accountId: row.accountId };
    },
    async newestTransactionDate(userId, accountId) {
      const [row] = await database
        .select({ date: transactions.date })
        .from(transactions)
        // Rows added by hand don't count: one dated today would start the first sync today and hide older bank rows.
        .where(and(eq(transactions.userId, userId), eq(transactions.accountId, accountId), ne(transactions.source, "manual")))
        .orderBy(desc(transactions.date))
        .limit(1);
      return row?.date ?? null;
    },
    async csvLabels(userId, accountId) {
      const rows = await database
        .select({ labelRaw: transactions.labelRaw, labelSimplified: transactions.labelDisplay, date: transactions.date })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.accountId, accountId),
            eq(transactions.source, "csv"),
            isNotNull(transactions.labelRaw),
            isNotNull(transactions.labelDisplay),
          ),
        );
      return rows.flatMap((r) =>
        r.labelRaw && r.labelSimplified ? [{ labelRaw: r.labelRaw, labelSimplified: r.labelSimplified, date: r.date }] : [],
      );
    },
    async commit(input) {
      const { import: created, rowsPossible } = await commitImport(database, {
        userId: input.userId,
        accountId: input.accountId,
        filename: input.filename,
        kind: "sync",
        rowsTotal: input.rowsTotal,
        rowsError: input.rowsError,
        transactions: input.rows,
        inTransaction: async (tx) => {
          if (input.balance) await saveBankCheckpoint(tx, input.userId, input.accountId, input.balance);
        },
      });
      return { importId: created.id, inserted: created.rowsInserted, duplicate: created.rowsDuplicate, possible: rowsPossible };
    },
    async markSynced(userId, linkId, { at, syncFrom }) {
      await database
        .update(bankAccountLinks)
        .set({ lastSyncedAt: at, syncFrom: sql`coalesce(${bankAccountLinks.syncFrom}, ${syncFrom}::date)` })
        .where(and(eq(bankAccountLinks.id, linkId), eq(bankAccountLinks.userId, userId)));
    },
  };
}

/**
 * Writes the outcome of one sync attempt (cron or Sync now) on the link: when, the error code (null
 * on success) and the start of the run of failures. A success ends the run; a failure keeps its
 * start; a rate limit is the bank's daily cap, not a failure, so it neither starts nor ends a run.
 */
export async function recordAttempt(
  database: typeof dbClient,
  userId: string,
  linkId: string,
  input: { at: Date; error: string | null },
): Promise<void> {
  const failingSince =
    input.error === null
      ? { failingSince: null }
      : input.error === "rate_limited"
        ? {}
        : { failingSince: sql`coalesce(${bankAccountLinks.failingSince}, ${input.at.toISOString()}::timestamptz)` };
  await database
    .update(bankAccountLinks)
    .set({ lastAttemptAt: input.at, lastError: input.error, ...failingSince })
    .where(and(eq(bankAccountLinks.id, linkId), eq(bankAccountLinks.userId, userId)));
}

export interface SyncableLink {
  id: string;
  lastSyncedAt: Date | null;
}

/** The user's imported links on active connections: what Sync now and sync on open can reach. */
export async function listSyncableLinks(database: typeof dbClient, userId: string): Promise<SyncableLink[]> {
  return database
    .select({ id: bankAccountLinks.id, lastSyncedAt: bankAccountLinks.lastSyncedAt })
    .from(bankAccountLinks)
    .innerJoin(bankConnections, eq(bankConnections.id, bankAccountLinks.connectionId))
    .where(
      and(
        eq(bankAccountLinks.userId, userId),
        eq(bankConnections.userId, userId),
        eq(bankConnections.status, "active"),
        isNotNull(bankAccountLinks.accountId),
        isNotNull(bankAccountLinks.linkedAt),
      ),
    )
    .orderBy(bankAccountLinks.id);
}

export interface DailySyncTarget {
  userId: string;
  email: string;
  linkId: string;
}

/** System job only: every imported link of an active connection whose consent hasn't ended. */
export async function listDailySyncTargets(database: typeof dbClient, now: Date): Promise<DailySyncTarget[]> {
  return database
    .select({ userId: bankAccountLinks.userId, email: users.email, linkId: bankAccountLinks.id })
    .from(bankAccountLinks)
    .innerJoin(bankConnections, eq(bankConnections.id, bankAccountLinks.connectionId))
    .innerJoin(users, eq(users.id, bankAccountLinks.userId))
    .where(
      and(
        eq(bankConnections.userId, bankAccountLinks.userId),
        eq(bankConnections.status, "active"),
        gt(bankConnections.validUntil, now),
        isNotNull(bankAccountLinks.accountId),
        isNotNull(bankAccountLinks.linkedAt),
      ),
    )
    .orderBy(bankAccountLinks.userId, bankAccountLinks.id);
}
