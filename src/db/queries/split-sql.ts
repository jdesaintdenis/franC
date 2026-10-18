import { and, eq, sql, type SQL } from "drizzle-orm";

import type { db as dbClient } from "../client";
import { transactions, transactionSplits } from "../schema";

/**
 * Conditions on `transactions` rows having (or not having) split parts. A transaction is
 * split exactly when it has parts. Written with explicit `"transactions"."id"` for the same
 * reason as transfer-sql.ts: drizzle drops table prefixes in single-table selects, which
 * would make the correlation resolve to the wrong table. Scoped by user_id and served by
 * the `transaction_id` index.
 */
export function isSplit(userId: string) {
  return sql`EXISTS (SELECT 1 FROM "transaction_splits" sp WHERE sp."user_id" = ${userId} AND sp."transaction_id" = "transactions"."id")`;
}

export function notSplit(userId: string) {
  return sql`NOT EXISTS (SELECT 1 FROM "transaction_splits" sp WHERE sp."user_id" = ${userId} AND sp."transaction_id" = "transactions"."id")`;
}

/**
 * The single place that defines "category spending lines": an unsplit transaction gives one
 * line (its own category and amount); a split one gives one line per part (part category and
 * amount, possibly a null category). The caller passes the row conditions (`inRange`), so
 * date, account, user and transfer filters stay in one place. Parts share the transaction's
 * sign and sum to it, so only per-category figures should read lines; month totals, the trend
 * and counts stay on whole transactions.
 */
export function categoryLines(database: Pick<typeof dbClient, "select">, userId: string, where: SQL | undefined) {
  return database
    .select({
      categoryId: sql<string | null>`CASE WHEN ${transactionSplits.id} IS NULL THEN ${transactions.categoryId} ELSE ${transactionSplits.categoryId} END`.as(
        "category_id",
      ),
      amountCents: sql<number>`coalesce(${transactionSplits.amountCents}, ${transactions.amountCents})`.as("amount_cents"),
      // For budgets: the month a line falls in (rollover, presets) and whether it is a recurring charge (pace).
      date: sql<string>`${transactions.date}`.as("date"),
      recurringId: sql<string | null>`${transactions.recurringId}`.as("recurring_id"),
    })
    .from(transactions)
    .leftJoin(
      transactionSplits,
      and(eq(transactionSplits.transactionId, transactions.id), eq(transactionSplits.userId, userId)),
    )
    .where(where)
    .as("lines");
}
