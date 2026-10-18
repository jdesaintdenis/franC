import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import { addDays } from "../../lib/recurring/dates";
import { CANDIDATE_WINDOW_DAYS, dayGap, detectTransfers } from "../../lib/transfers/detect";
import { validateTransferLink, type TransferLinkError } from "../../lib/transfers/validate";
import type { db as dbClient } from "../client";
import { accounts, merchants, savingsGoalContributions, savingsGoals, transactions, transferRejections, transfers, type Transfer } from "../schema";
import { isSplit, notSplit } from "./split-sql";
import { countable, notInTransfer } from "./transfer-sql";

/**
 * Finds new internal-transfer pairs among the user's unpaired transactions (all dates,
 * all accounts) and inserts them, in one DB transaction. Existing pairs are never
 * removed or changed; rejected pairs are never suggested. Returns the number inserted.
 */
export async function refreshTransfers(database: typeof dbClient, userId: string): Promise<number> {
  return database.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        date: transactions.date,
        amountCents: transactions.amountCents,
        bankSubcategory: transactions.bankSubcategory,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), countable(userId), notSplit(userId)));
    if (rows.length === 0) return 0;

    const rejected = await tx
      .select({
        outTransactionId: transferRejections.outTransactionId,
        inTransactionId: transferRejections.inTransactionId,
      })
      .from(transferRejections)
      .where(eq(transferRejections.userId, userId));

    const pairs = detectTransfers(rows, rejected);
    if (pairs.length === 0) return 0;

    // Lock the rows, then re-check in a fresh statement that none was split or paired
    // meanwhile: saveSplit and linkTransfer lock the same rows, so exactly one side wins.
    const ids = [...new Set(pairs.flatMap((p) => [p.outTransactionId, p.inTransactionId]))];
    await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids)))
      .orderBy(asc(transactions.id))
      .for("update");
    const stillFree = new Set(
      (
        await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids), notSplit(userId)))
      ).map((r) => r.id),
    );
    const free = pairs.filter((p) => stillFree.has(p.outTransactionId) && stillFree.has(p.inTransactionId));
    if (free.length === 0) return 0;

    // A concurrent refresh may have paired the same rows: the unique constraints decide.
    const inserted = await tx
      .insert(transfers)
      .values(free.map((p) => ({ userId, ...p })))
      .onConflictDoNothing()
      .returning({ id: transfers.id });
    return inserted.length;
  });
}

/** Confirming or linking a pair is the user looking at both legs: they leave the review queue (Slice 26). */
export async function markLegsReviewed(tx: Pick<typeof dbClient, "update">, userId: string, ids: string[]): Promise<void> {
  await tx
    .update(transactions)
    .set({ reviewedAt: sql`now()` })
    .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids)));
}

/** Marks a detected pair as confirmed (and both legs as reviewed). Null when the transfer isn't the user's. */
export async function confirmTransfer(
  database: typeof dbClient,
  userId: string,
  transferId: string,
): Promise<Transfer | null> {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .update(transfers)
      .set({ status: "confirmed" })
      .where(and(eq(transfers.id, transferId), eq(transfers.userId, userId)))
      .returning();
    if (!row) return null;
    await markLegsReviewed(tx, userId, [row.outTransactionId, row.inTransactionId]);
    return row;
  });
}

/**
 * Dissolves a pair and remembers it, so detection never suggests it again (a pair franC created is deleted
 * with its created row instead). One DB transaction. Null when the transfer isn't the user's.
 */
export async function unlinkTransfer(
  database: typeof dbClient,
  userId: string,
  transferId: string,
): Promise<Transfer | null> {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .delete(transfers)
      .where(and(eq(transfers.id, transferId), eq(transfers.userId, userId)))
      .returning();
    if (!row) return null;
    // A pair franC created (Move to savings) has no real counterpart once unlinked: the created row goes,
    // and nothing is remembered, since there is nothing to suggest again.
    const created = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          inArray(transactions.id, [row.outTransactionId, row.inTransactionId]),
          eq(transactions.source, "franc"),
        ),
      );
    if (created.length > 0) {
      await tx.delete(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.id, created.map((c) => c.id))));
      return row;
    }
    await tx
      .insert(transferRejections)
      .values({ userId, outTransactionId: row.outTransactionId, inTransactionId: row.inTransactionId })
      .onConflictDoNothing();
    return row;
  });
}

export type LinkTransferResult =
  | { ok: true; transfer: Transfer }
  | { ok: false; error: "notFound" | "alreadyLinked" | TransferLinkError };

/**
 * Links two transactions by hand as a confirmed pair. The rows are ordered by sign,
 * locked, validated and checked to be unpaired inside one DB transaction. A rejection
 * recorded earlier for this pair is cleared.
 */
export async function linkTransfer(
  database: typeof dbClient,
  userId: string,
  transactionIdA: string,
  transactionIdB: string,
): Promise<LinkTransferResult> {
  if (transactionIdA === transactionIdB) return { ok: false, error: "notFound" };
  return database.transaction(async (tx) => {
    const rows = await tx
      .select({ id: transactions.id, accountId: transactions.accountId, amountCents: transactions.amountCents })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, [transactionIdA, transactionIdB])))
      .orderBy(asc(transactions.id))
      .for("update");
    if (rows.length !== 2) return { ok: false as const, error: "notFound" as const };

    // A separate statement after the locks, so it sees a split committed while we waited.
    const splitRows = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, [transactionIdA, transactionIdB]), isSplit(userId)));
    const splitIds = new Set(splitRows.map((r) => r.id));

    const [first, second] = rows;
    const [out, inn] = first.amountCents < second.amountCents ? [first, second] : [second, first];
    const invalid = validateTransferLink(
      { ...out, isSplit: splitIds.has(out.id) },
      { ...inn, isSplit: splitIds.has(inn.id) },
    );
    if (invalid) return { ok: false as const, error: invalid };

    const [existing] = await tx
      .select({ id: transfers.id })
      .from(transfers)
      .where(
        and(
          eq(transfers.userId, userId),
          or(
            inArray(transfers.outTransactionId, [out.id, inn.id]),
            inArray(transfers.inTransactionId, [out.id, inn.id]),
          ),
        ),
      )
      .limit(1);
    if (existing) return { ok: false as const, error: "alreadyLinked" as const };

    const [transfer] = await tx
      .insert(transfers)
      .values({ userId, outTransactionId: out.id, inTransactionId: inn.id, status: "confirmed" })
      .returning();
    await tx
      .delete(transferRejections)
      .where(
        and(
          eq(transferRejections.userId, userId),
          eq(transferRejections.outTransactionId, out.id),
          eq(transferRejections.inTransactionId, inn.id),
        ),
      );
    await markLegsReviewed(tx, userId, [out.id, inn.id]);
    return { ok: true as const, transfer };
  });
}

export interface TransferCandidate {
  id: string;
  date: string;
  amountCents: number;
  label: string;
  accountId: string;
  /** The user's own data, not translated. */
  accountName: string;
  /** Absolute days between the two dates. */
  gapDays: number;
}

/**
 * Unpaired transactions that could be the other leg of `transactionId`: opposite sign,
 * same absolute amount, another account, within CANDIDATE_WINDOW_DAYS; closest first.
 * Null when the transaction isn't the user's; empty when it is already in a transfer or is split.
 */
export async function listTransferCandidates(
  database: typeof dbClient,
  userId: string,
  transactionId: string,
): Promise<TransferCandidate[] | null> {
  const [source] = await database
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      date: transactions.date,
      amountCents: transactions.amountCents,
      paired: sql<boolean>`NOT ${notInTransfer(userId)}`,
      split: sql<boolean>`${isSplit(userId)}`,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, transactionId)));
  if (!source) return null;
  if (source.paired || source.split) return [];

  const rows = await database
    .select({
      id: transactions.id,
      date: transactions.date,
      amountCents: transactions.amountCents,
      labelDisplay: transactions.labelDisplay,
      labelRaw: transactions.labelRaw,
      merchantName: merchants.name,
      accountId: transactions.accountId,
      accountName: accounts.name,
    })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.userId, userId)))
    .leftJoin(merchants, and(eq(merchants.id, transactions.merchantId), eq(merchants.userId, userId)))
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.amountCents, -source.amountCents),
        sql`${transactions.accountId} <> ${source.accountId}`,
        // Savings accounts are filled by "Move to savings" (a pair franC creates), never by hand links.
        eq(accounts.savings, false),
        sql`${transactions.date} >= ${addDays(source.date, -CANDIDATE_WINDOW_DAYS)}`,
        sql`${transactions.date} <= ${addDays(source.date, CANDIDATE_WINDOW_DAYS)}`,
        countable(userId),
        notSplit(userId),
      ),
    );

  return rows
    .map((r) => ({
      id: r.id,
      date: r.date,
      amountCents: r.amountCents,
      label: r.merchantName ?? r.labelDisplay ?? r.labelRaw ?? "",
      accountId: r.accountId,
      accountName: r.accountName,
      gapDays: dayGap(source.date, r.date),
    }))
    .sort((a, b) => a.gapDays - b.gapDays || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.id < b.id ? -1 : 1));
}

export interface TransferForTransaction {
  id: string;
  status: "detected" | "confirmed";
  counterpart: {
    id: string;
    date: string;
    amountCents: number;
    label: string;
    accountId: string;
    accountName: string;
    /** Created by franC when money was moved to a Savings account (Slice 52). */
    createdByFranc: boolean;
  };
  /** Whether the transaction asked about is the row franC created. */
  selfCreatedByFranc: boolean;
  /** The leg on a Savings account, when exactly one leg is on one (Slice 55). */
  savingsLeg: { id: string; accountId: string; amountCents: number } | null;
  /** The goal that leg's money belongs to. */
  goal: { id: string; name: string } | null;
}

/** The pair a transaction belongs to, seen from that transaction. Null when unpaired or not the user's. */
export async function getTransferForTransaction(
  database: typeof dbClient,
  userId: string,
  transactionId: string,
): Promise<TransferForTransaction | null> {
  const [pair] = await database
    .select()
    .from(transfers)
    .where(
      and(
        eq(transfers.userId, userId),
        or(eq(transfers.outTransactionId, transactionId), eq(transfers.inTransactionId, transactionId)),
      ),
    );
  if (!pair) return null;

  const counterpartId = pair.outTransactionId === transactionId ? pair.inTransactionId : pair.outTransactionId;
  const [other] = await database
    .select({
      id: transactions.id,
      date: transactions.date,
      amountCents: transactions.amountCents,
      labelDisplay: transactions.labelDisplay,
      labelRaw: transactions.labelRaw,
      merchantName: merchants.name,
      accountId: transactions.accountId,
      accountName: accounts.name,
      source: transactions.source,
    })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.userId, userId)))
    .leftJoin(merchants, and(eq(merchants.id, transactions.merchantId), eq(merchants.userId, userId)))
    .where(and(eq(transactions.userId, userId), eq(transactions.id, counterpartId)));
  if (!other) return null;
  const [self] = await database
    .select({ source: transactions.source })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, transactionId)));

  // Which goal the pair's money went to: set only when exactly one leg sits on a Savings account.
  const legs = await database
    .select({ id: transactions.id, accountId: transactions.accountId, amountCents: transactions.amountCents, savings: accounts.savings })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.userId, userId)))
    .where(and(eq(transactions.userId, userId), inArray(transactions.id, [pair.outTransactionId, pair.inTransactionId])));
  const onSavings = legs.filter((l) => l.savings);
  const savingsLeg = onSavings.length === 1 ? { id: onSavings[0].id, accountId: onSavings[0].accountId, amountCents: onSavings[0].amountCents } : null;
  const [goal] = savingsLeg
    ? await database
        .select({ id: savingsGoals.id, name: savingsGoals.name })
        .from(savingsGoalContributions)
        .innerJoin(savingsGoals, and(eq(savingsGoals.id, savingsGoalContributions.goalId), eq(savingsGoals.userId, userId)))
        .where(and(eq(savingsGoalContributions.transactionId, savingsLeg.id), eq(savingsGoalContributions.userId, userId)))
    : [];

  return {
    id: pair.id,
    status: pair.status,
    counterpart: {
      id: other.id,
      date: other.date,
      amountCents: other.amountCents,
      label: other.merchantName ?? other.labelDisplay ?? other.labelRaw ?? "",
      accountId: other.accountId,
      accountName: other.accountName,
      createdByFranc: other.source === "franc",
    },
    selfCreatedByFranc: self?.source === "franc",
    savingsLeg,
    goal: goal ?? null,
  };
}
