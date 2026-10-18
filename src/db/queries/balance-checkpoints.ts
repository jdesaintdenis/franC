import { and, desc, eq, sql } from "drizzle-orm";

import type { db as dbClient } from "../client";
import { balanceCheckpoints, bankAccountLinks } from "../schema";

type Executor = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];
type Database = typeof dbClient | Executor;

// Every query here is scoped by userId.

export type BankCheckpointInput = {
  /** ISO day the balance is at the end of. */
  date: string;
  amountCents: number;
  bankName: string;
  fetchedAt: Date;
  balanceType: string;
};

/**
 * Saves the bank's balance for a day. A second read the same day replaces amount, time and type but
 * keeps `accepted_gap_cents`: the user's acceptance belongs to the day, not to one reading.
 */
export async function saveBankCheckpoint(
  database: Database,
  userId: string,
  accountId: string,
  input: BankCheckpointInput,
): Promise<void> {
  await database
    .insert(balanceCheckpoints)
    .values({ userId, accountId, source: "bank", ...input })
    .onConflictDoUpdate({
      target: [balanceCheckpoints.accountId, balanceCheckpoints.date],
      targetWhere: sql`${balanceCheckpoints.source} = 'bank'`,
      set: {
        amountCents: input.amountCents,
        bankName: input.bankName,
        fetchedAt: input.fetchedAt,
        balanceType: input.balanceType,
      },
    });
}

/** Sets (or replaces) the account's manual checkpoint. The caller has checked the account is the user's. */
export async function upsertManualCheckpoint(
  database: Database,
  userId: string,
  accountId: string,
  input: { date: string; amountCents: number },
): Promise<void> {
  await database
    .insert(balanceCheckpoints)
    .values({ userId, accountId, source: "manual", ...input })
    .onConflictDoUpdate({
      target: [balanceCheckpoints.accountId],
      targetWhere: sql`${balanceCheckpoints.source} = 'manual'`,
      set: { date: input.date, amountCents: input.amountCents, acceptedGapCents: 0 },
    });
}

export async function deleteManualCheckpoint(database: Database, userId: string, accountId: string): Promise<void> {
  await database
    .delete(balanceCheckpoints)
    .where(
      and(
        eq(balanceCheckpoints.userId, userId),
        eq(balanceCheckpoints.accountId, accountId),
        eq(balanceCheckpoints.source, "manual"),
      ),
    );
}

/** On disconnect, each linked account keeps its last bank balance as its manual one. Bank checkpoints stay. */
export async function promoteLatestBankCheckpoints(
  database: Database,
  userId: string,
  connectionId: string,
): Promise<void> {
  const linked = await database
    .select({ accountId: bankAccountLinks.accountId })
    .from(bankAccountLinks)
    .where(and(eq(bankAccountLinks.userId, userId), eq(bankAccountLinks.connectionId, connectionId)));
  for (const { accountId } of linked) {
    if (!accountId) continue;
    const [latest] = await database
      .select({ date: balanceCheckpoints.date, amountCents: balanceCheckpoints.amountCents })
      .from(balanceCheckpoints)
      .where(
        and(
          eq(balanceCheckpoints.userId, userId),
          eq(balanceCheckpoints.accountId, accountId),
          eq(balanceCheckpoints.source, "bank"),
        ),
      )
      .orderBy(desc(balanceCheckpoints.date))
      .limit(1);
    if (latest) await upsertManualCheckpoint(database, userId, accountId, latest);
  }
}

