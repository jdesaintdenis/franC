import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";

import type { db as dbClient } from "../client";
import { accounts, duplicateCandidates, imports, merchants, transactionSplits, transactions, transfers } from "../schema";
import { selectListItemRows, toListItems, type TransactionListItem } from "./transactions";

/** Where a queue row came from. */
export interface ReviewImportInfo {
  id: string;
  /** The file's name, or the bank's name for a sync run. */
  filename: string;
  kind: "csv" | "sync";
  /** ISO timestamp of the upload. */
  uploadedAt: string;
  /** The import's account name (the user's own data, not translated). */
  accountName: string;
}

/** A transaction to review: the same shape as the Transactions list, plus its import. */
export interface ReviewQueueItem extends TransactionListItem {
  import: ReviewImportInfo;
  /** Existing rows this one may be the same purchase as (empty unless it is a possible duplicate). */
  possibleDuplicates: PossibleDuplicate[];
}

export interface PossibleDuplicate {
  id: string;
  date: string;
  amountCents: number;
  /** As the list shows it: merchant name, else short label, else raw bank label. */
  name: string;
  source: "csv" | "sync";
  /** When the row's import (or sync run) happened. */
  importedAt: Date;
}

/** The possible-duplicate candidates of some rows in one query, newest date first (scoped by user_id). */
async function loadPossibleDuplicates(
  database: typeof dbClient,
  userId: string,
  ids: string[],
): Promise<Map<string, PossibleDuplicate[]>> {
  const byRow = new Map<string, PossibleDuplicate[]>();
  if (ids.length === 0) return byRow;
  const rows = await database
    .select({
      rowId: duplicateCandidates.transactionId,
      id: transactions.id,
      date: transactions.date,
      amountCents: transactions.amountCents,
      merchantName: merchants.name,
      labelDisplay: transactions.labelDisplay,
      labelRaw: transactions.labelRaw,
      // Franc-created rows are born reviewed, so a possible duplicate is never one.
      source: sql<"csv" | "sync">`${transactions.source}`,
      importedAt: imports.uploadedAt,
    })
    .from(duplicateCandidates)
    .innerJoin(
      transactions,
      and(eq(transactions.id, duplicateCandidates.candidateId), eq(transactions.userId, userId)),
    )
    .innerJoin(imports, and(eq(imports.id, transactions.importId), eq(imports.userId, userId)))
    .leftJoin(merchants, and(eq(merchants.id, transactions.merchantId), eq(merchants.userId, userId)))
    .where(and(eq(duplicateCandidates.userId, userId), inArray(duplicateCandidates.transactionId, ids)))
    .orderBy(desc(transactions.date), asc(transactions.id));
  for (const r of rows) {
    const list = byRow.get(r.rowId) ?? [];
    list.push({
      id: r.id,
      date: r.date,
      amountCents: r.amountCents,
      name: r.merchantName ?? r.labelDisplay ?? r.labelRaw ?? "",
      source: r.source,
      importedAt: r.importedAt,
    });
    byRow.set(r.rowId, list);
  }
  return byRow;
}

export interface ReviewQueue {
  /** At most `limit` items, newest import first, then newest date first. */
  items: ReviewQueueItem[];
  /** Everything waiting for review, including items beyond `limit`. */
  total: number;
}

/** Which rows `markReviewed` acts on. Only rows still to review are changed. */
export type ReviewTarget =
  | { ids: string[] }
  | { importId: string }
  | { all: true };

export const DEFAULT_QUEUE_LIMIT = 500;

/** How many of the user's transactions are waiting for review (served by the partial index). */
export async function countToReview(database: typeof dbClient, userId: string): Promise<number> {
  const [row] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNull(transactions.reviewedAt)));
  return row?.total ?? 0;
}

/** How many of one import's rows are still to review. */
export async function countToReviewForImport(
  database: typeof dbClient,
  userId: string,
  importId: string,
): Promise<number> {
  const [row] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.importId, importId), isNull(transactions.reviewedAt)));
  return row?.total ?? 0;
}

/**
 * The transactions to review, ordered by import upload time (newest first), import id, then
 * date and id (newest first), so rows of one import are consecutive. Capped at `limit`.
 */
export async function listReviewQueue(
  database: typeof dbClient,
  userId: string,
  limit = DEFAULT_QUEUE_LIMIT,
): Promise<ReviewQueue> {
  const [total, ordered] = await Promise.all([
    countToReview(database, userId),
    database
      .select({
        id: transactions.id,
        importId: imports.id,
        filename: imports.filename,
        kind: sql<"csv" | "sync">`${imports.kind}`,
        uploadedAt: imports.uploadedAt,
        accountName: accounts.name,
      })
      .from(transactions)
      .innerJoin(imports, and(eq(imports.id, transactions.importId), eq(imports.userId, userId)))
      .innerJoin(accounts, and(eq(accounts.id, imports.accountId), eq(accounts.userId, userId)))
      .where(and(eq(transactions.userId, userId), isNull(transactions.reviewedAt)))
      .orderBy(desc(imports.uploadedAt), asc(imports.id), desc(transactions.date), desc(transactions.id))
      .limit(limit),
  ]);
  if (ordered.length === 0) return { items: [], total };

  const rows = await selectListItemRows(database, userId).where(
    and(eq(transactions.userId, userId), inArray(transactions.id, ordered.map((o) => o.id))),
  );
  const itemById = new Map((await toListItems(database, userId, rows)).map((i) => [i.id, i]));
  const duplicatesById = await loadPossibleDuplicates(database, userId, ordered.map((o) => o.id));

  const items: ReviewQueueItem[] = [];
  for (const o of ordered) {
    const item = itemById.get(o.id);
    if (!item) continue;
    items.push({
      ...item,
      import: { id: o.importId, filename: o.filename, kind: o.kind, uploadedAt: o.uploadedAt.toISOString(), accountName: o.accountName },
      possibleDuplicates: duplicatesById.get(o.id) ?? [],
    });
  }
  return { items, total };
}

/**
 * Rows that say where their money went (SPEC §73 A): a category, a split, a confirmed transfer or
 * ignored. Only these can be validated; the same rule lives in `lib/transactions/validation.ts`.
 */
function hasDestinationSql(): SQL {
  return or(
    isNotNull(transactions.categoryId),
    isNotNull(transactions.ignoredAt),
    sql`exists (select 1 from ${transactionSplits} s where s.transaction_id = ${transactions.id})`,
    sql`exists (select 1 from ${transfers} t where t.status = 'confirmed' and (t.out_transaction_id = ${transactions.id} or t.in_transaction_id = ${transactions.id}))`,
  ) as SQL;
}

/** How many rows still to review have no destination yet (they stay in the queue). Limited to `target` when given. */
export async function countWaitingForCategory(
  database: typeof dbClient,
  userId: string,
  target?: ReviewTarget,
): Promise<number> {
  const scope = [eq(transactions.userId, userId), isNull(transactions.reviewedAt), sql`not (${hasDestinationSql()})`];
  if (target && "ids" in target) {
    if (target.ids.length === 0) return 0;
    scope.push(inArray(transactions.id, target.ids));
  } else if (target && "importId" in target) scope.push(eq(transactions.importId, target.importId));
  const [row] = await database.select({ total: sql<number>`count(*)::int` }).from(transactions).where(and(...scope));
  return row?.total ?? 0;
}

/**
 * Marks rows as reviewed and returns the ids that changed (only rows that were still to
 * review), which is what Undo needs. Ids and imports that aren't the user's match nothing.
 */
export async function markReviewed(
  database: typeof dbClient,
  userId: string,
  target: ReviewTarget,
): Promise<string[]> {
  const scope = [eq(transactions.userId, userId), isNull(transactions.reviewedAt), hasDestinationSql()];
  if ("ids" in target) {
    if (target.ids.length === 0) return [];
    scope.push(inArray(transactions.id, target.ids));
  } else if ("importId" in target) {
    scope.push(eq(transactions.importId, target.importId));
  }
  const changed = await database
    .update(transactions)
    .set({ reviewedAt: sql`now()` })
    .where(and(...scope))
    .returning({ id: transactions.id });
  return changed.map((r) => r.id);
}

/** Undo for `markReviewed`: puts reviewed rows back in the queue. Returns how many changed. */
export async function markToReview(database: typeof dbClient, userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const changed = await database
    .update(transactions)
    .set({ reviewedAt: null })
    .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids), isNotNull(transactions.reviewedAt)))
    .returning({ id: transactions.id });
  return changed.length;
}
