import { and, eq } from "drizzle-orm";

import type { db as dbClient } from "../client";
import { duplicateCandidates, transactionMatches, transactions } from "../schema";

export type MergeDuplicateResult = { ok: true } | { ok: false; error: "notFound" };

/**
 * "Same transaction": the row is the existing candidate seen again. The row's identity (and any
 * identity already merged into it) moves onto the candidate as a match, so a re-sync or re-import
 * never brings it back, then the row is deleted (its candidate links, tags, split and transfer
 * go with it). The candidate keeps its category, note, tags and split. Everything is scoped by
 * user_id and runs in one transaction.
 */
export async function mergeDuplicate(
  database: typeof dbClient,
  userId: string,
  rowId: string,
  candidateId: string,
): Promise<MergeDuplicateResult> {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, rowId), eq(transactions.userId, userId)));
    if (!row || row.id === candidateId) return { ok: false, error: "notFound" };
    const [link] = await tx
      .select({ candidateId: duplicateCandidates.candidateId })
      .from(duplicateCandidates)
      .where(
        and(
          eq(duplicateCandidates.userId, userId),
          eq(duplicateCandidates.transactionId, rowId),
          eq(duplicateCandidates.candidateId, candidateId),
        ),
      );
    if (!link) return { ok: false, error: "notFound" };
    const [candidate] = await tx
      .select({ id: transactions.id, accountId: transactions.accountId })
      .from(transactions)
      .where(and(eq(transactions.id, candidateId), eq(transactions.userId, userId)));
    if (!candidate) return { ok: false, error: "notFound" };

    // Identities the row had already absorbed move first; they are distinct from the row's own,
    // which lives in `transactions`, so the unique keys of the table cannot collide. DO NOTHING
    // stays as the last line of defence.
    await tx
      .update(transactionMatches)
      .set({ transactionId: candidate.id })
      .where(and(eq(transactionMatches.userId, userId), eq(transactionMatches.transactionId, row.id)));
    await tx
      .insert(transactionMatches)
      .values({
        userId,
        accountId: row.accountId,
        transactionId: candidate.id,
        importId: row.importId,
        source: row.source,
        dedupeHash: row.dedupeHash,
        occurrenceIndex: row.occurrenceIndex,
        externalId: row.externalId,
      })
      .onConflictDoNothing();
    await tx.delete(transactions).where(and(eq(transactions.id, row.id), eq(transactions.userId, userId)));
    return { ok: true };
  });
}

/**
 * "Keep both": forgets the candidates of a possible duplicate. The row stays in the queue. It is
 * not asked again because the matcher only looks at incoming rows. Returns false for a row that
 * is not the user's.
 */
export async function keepBoth(database: typeof dbClient, userId: string, rowId: string): Promise<boolean> {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, rowId), eq(transactions.userId, userId)));
    if (!row) return false;
    await tx
      .delete(duplicateCandidates)
      .where(and(eq(duplicateCandidates.userId, userId), eq(duplicateCandidates.transactionId, rowId)));
    return true;
  });
}
