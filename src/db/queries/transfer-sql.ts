import { sql } from "drizzle-orm";

/**
 * Conditions on `transactions` rows being in an internal transfer (either status).
 * Written with explicit `"transactions"."id"` because drizzle drops table prefixes in
 * single-table selects, which would make the correlation resolve to `transfers.id`.
 * Both are scoped by user_id and use the unique index of each transfer column.
 */
export function notInTransfer(userId: string) {
  return sql`(NOT EXISTS (SELECT 1 FROM "transfers" tr WHERE tr."user_id" = ${userId} AND tr."out_transaction_id" = "transactions"."id")
    AND NOT EXISTS (SELECT 1 FROM "transfers" tr WHERE tr."user_id" = ${userId} AND tr."in_transaction_id" = "transactions"."id"))`;
}

export function inTransfer(userId: string) {
  return sql`(EXISTS (SELECT 1 FROM "transfers" tr WHERE tr."user_id" = ${userId} AND tr."out_transaction_id" = "transactions"."id")
    OR EXISTS (SELECT 1 FROM "transfers" tr WHERE tr."user_id" = ${userId} AND tr."in_transaction_id" = "transactions"."id"))`;
}

/**
 * The leg on a current account of a transfer whose other leg is on a Savings account (money put aside). It stays
 * a payment for recurring detection: a standing order to savings is a regular payment, and detection deletes a
 * confirmed item once none of its rows are left (Slice 52).
 */
export function savingsSideLeg(userId: string) {
  return sql`EXISTS (
    SELECT 1 FROM "transfers" tr
      JOIN "transactions" other ON other."user_id" = ${userId}
        AND other."id" = CASE WHEN tr."out_transaction_id" = "transactions"."id" THEN tr."in_transaction_id" ELSE tr."out_transaction_id" END
      JOIN "accounts" other_account ON other_account."id" = other."account_id" AND other_account."user_id" = ${userId}
      JOIN "accounts" own_account ON own_account."id" = "transactions"."account_id" AND own_account."user_id" = ${userId}
    WHERE tr."user_id" = ${userId}
      AND "transactions"."id" IN (tr."out_transaction_id", tr."in_transaction_id")
      AND other_account."savings" AND NOT own_account."savings")`;
}

/**
 * The incoming leg of a transfer from an account left out of Reste à vivre (Savings, or switched off): money brought
 * into the counted accounts, which Slice 79 lets the user keep for next month.
 */
export function inFromUncountedAccount(userId: string) {
  return sql`EXISTS (
    SELECT 1 FROM "transfers" tr
      JOIN "transactions" other ON other."user_id" = ${userId} AND other."id" = tr."out_transaction_id"
      JOIN "accounts" other_account ON other_account."id" = other."account_id" AND other_account."user_id" = ${userId}
    WHERE tr."user_id" = ${userId}
      AND tr."in_transaction_id" = "transactions"."id"
      AND (other_account."savings" OR NOT other_account."in_safe_to_spend"))`;
}

/** Rows the user has not set aside (see `transactions.ignored_at`). Explicit prefix for the same reason as above. */
export function notIgnored() {
  return sql`"transactions"."ignored_at" IS NULL`;
}

/**
 * What totals, detection and pairing may see: not in an internal transfer and not ignored.
 * Dedupe and matching deliberately do NOT use it, so an ignored row never comes back.
 */
export function countable(userId: string) {
  return sql`(${notInTransfer(userId)} AND ${notIgnored()})`;
}
