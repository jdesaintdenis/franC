import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { validateSplit, type SplitErrorCode, type SplitPartInput } from "../../lib/splits/validate";
import type { db as dbClient } from "../client";
import { categories, transactions, transactionSplits } from "../schema";
import { inTransfer } from "./transfer-sql";

type Selectable = Pick<typeof dbClient, "select">;

/** Same display shape as a transaction row's category. */
export interface SplitPartCategory {
  id: string;
  name: string;
  color: string;
  /** A top-level category's own icon; null for a subcategory. */
  icon: string | null;
  parentName: string | null;
}

export interface SplitPart {
  id: string;
  /** Null when the part's category was deleted. */
  category: SplitPartCategory | null;
  /** Signed cents, same sign as the transaction. */
  amountCents: number;
}

export interface SplitDetail {
  transactionId: string;
  /** The whole transaction's signed amount. */
  amountCents: number;
  /** Ordered by position; empty when the transaction is not split. */
  parts: SplitPart[];
}

export type SplitWriteError = "not_found" | "in_transfer" | "category_not_found" | SplitErrorCode;

export type SaveSplitResult = { ok: true; parts: SplitPart[] } | { ok: false; error: SplitWriteError };

export type RemoveSplitResult =
  | {
      ok: true;
      /** False when the transaction was not split (nothing changed). */
      removed: boolean;
      /** The row's own category, which applies again now that the split is gone. */
      category: SplitPartCategory | null;
      categorySource: "manual" | "rule" | "bank" | "guess" | null;
    }
  | { ok: false; error: "not_found" };

/**
 * Parts of a page of transactions, keyed by transaction id and ordered by position.
 * Scoped by user_id on the parts, the categories and their parents.
 */
export async function loadSplitParts(
  database: Selectable,
  userId: string,
  transactionIds: string[],
): Promise<Map<string, SplitPart[]>> {
  const result = new Map<string, SplitPart[]>();
  if (transactionIds.length === 0) return result;
  const parent = alias(categories, "parent_category");
  const rows = await database
    .select({
      id: transactionSplits.id,
      transactionId: transactionSplits.transactionId,
      amountCents: transactionSplits.amountCents,
      categoryId: categories.id,
      categoryName: categories.name,
      categoryColor: categories.color,
      categoryIcon: categories.icon,
      parentName: parent.name,
    })
    .from(transactionSplits)
    .leftJoin(categories, and(eq(categories.id, transactionSplits.categoryId), eq(categories.userId, userId)))
    .leftJoin(parent, and(eq(parent.id, categories.parentId), eq(parent.userId, userId)))
    .where(and(eq(transactionSplits.userId, userId), inArray(transactionSplits.transactionId, transactionIds)))
    .orderBy(asc(transactionSplits.transactionId), asc(transactionSplits.position));
  for (const r of rows) {
    const part: SplitPart = {
      id: r.id,
      category:
        r.categoryId !== null && r.categoryName !== null && r.categoryColor !== null
          ? { id: r.categoryId, name: r.categoryName, color: r.categoryColor, icon: r.categoryIcon, parentName: r.parentName }
          : null,
      amountCents: r.amountCents,
    };
    const list = result.get(r.transactionId);
    if (list) list.push(part);
    else result.set(r.transactionId, [part]);
  }
  return result;
}

/** The parts of one of the user's transactions; null when the transaction isn't theirs. */
export async function getSplit(
  database: typeof dbClient,
  userId: string,
  transactionId: string,
): Promise<SplitDetail | null> {
  const [row] = await database
    .select({ id: transactions.id, amountCents: transactions.amountCents })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));
  if (!row) return null;
  const parts = (await loadSplitParts(database, userId, [transactionId])).get(transactionId) ?? [];
  return { transactionId: row.id, amountCents: row.amountCents, parts };
}

/**
 * Replaces all parts of a transaction, in one DB transaction. The row is locked first (like
 * linkTransfer does), so a concurrent split and transfer link cannot both win. The
 * transaction's own amount, labels and category are left untouched.
 */
export async function saveSplit(
  database: typeof dbClient,
  userId: string,
  transactionId: string,
  parts: readonly SplitPartInput[],
): Promise<SaveSplitResult> {
  return database.transaction(async (tx): Promise<SaveSplitResult> => {
    const [row] = await tx
      .select({ id: transactions.id, amountCents: transactions.amountCents })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
      .for("update");
    if (!row) return { ok: false, error: "not_found" };

    // A separate statement after the lock, so it sees a transfer committed while we waited.
    const [paired] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId), inTransfer(userId)));
    if (paired) return { ok: false, error: "in_transfer" };

    const validation = validateSplit(row.amountCents, parts);
    if (!validation.ok) return { ok: false, error: validation.error };

    const categoryIds = [...new Set(parts.flatMap((p) => (p.categoryId === null ? [] : [p.categoryId])))];
    const owned = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.userId, userId), inArray(categories.id, categoryIds)));
    if (owned.length !== categoryIds.length) return { ok: false, error: "category_not_found" };

    await tx
      .delete(transactionSplits)
      .where(and(eq(transactionSplits.transactionId, transactionId), eq(transactionSplits.userId, userId)));
    await tx.insert(transactionSplits).values(
      parts.map((p, position) => ({
        userId,
        transactionId,
        categoryId: p.categoryId,
        amountCents: p.amountCents,
        position,
      })),
    );

    // Splitting is categorizing: the row counts as reviewed (Slice 26).
    await tx
      .update(transactions)
      .set({ reviewedAt: sql`now()` })
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));

    const saved = (await loadSplitParts(tx, userId, [transactionId])).get(transactionId) ?? [];
    return { ok: true, parts: saved };
  });
}

/**
 * Removes the split: the row's own category (kept untouched while split) applies again.
 * Removing a split that doesn't exist is a no-op.
 */
export async function removeSplit(
  database: typeof dbClient,
  userId: string,
  transactionId: string,
): Promise<RemoveSplitResult> {
  return database.transaction(async (tx): Promise<RemoveSplitResult> => {
    const [locked] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
      .for("update");
    if (!locked) return { ok: false, error: "not_found" };

    const deleted = await tx
      .delete(transactionSplits)
      .where(and(eq(transactionSplits.transactionId, transactionId), eq(transactionSplits.userId, userId)))
      .returning({ id: transactionSplits.id });

    const parent = alias(categories, "parent_category");
    const [own] = await tx
      .select({
        categorySource: transactions.categorySource,
        categoryId: categories.id,
        categoryName: categories.name,
        categoryColor: categories.color,
        categoryIcon: categories.icon,
        parentName: parent.name,
      })
      .from(transactions)
      .leftJoin(categories, and(eq(categories.id, transactions.categoryId), eq(categories.userId, userId)))
      .leftJoin(parent, and(eq(parent.id, categories.parentId), eq(parent.userId, userId)))
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));

    return {
      ok: true,
      removed: deleted.length > 0,
      category:
        own && own.categoryId !== null && own.categoryName !== null && own.categoryColor !== null
          ? { id: own.categoryId, name: own.categoryName, color: own.categoryColor, icon: own.categoryIcon, parentName: own.parentName }
          : null,
      categorySource: own?.categorySource ?? null,
    };
  });
}
