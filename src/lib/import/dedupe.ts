import { createHash } from "node:crypto";

import type { KeyedTransaction, ParsedTransaction } from "./types";

type HashInput = Pick<ParsedTransaction, "date" | "amountCents" | "labelNormalized">;

/** JSON encoding avoids separator collisions between fields. */
export function computeDedupeHash(accountId: string, tx: HashInput): string {
  return createHash("sha256")
    .update(JSON.stringify([accountId, tx.date, tx.amountCents, tx.labelNormalized]))
    .digest("hex");
}

/**
 * Assigns `occurrenceIndex` (0, 1, 2...) per hash within the file, so
 * genuinely identical same-day transactions stay distinct. Order-independent
 * because identical rows are indistinguishable.
 */
export function assignDedupeKeys(
  transactions: ParsedTransaction[],
  accountId: string,
): KeyedTransaction[] {
  const seen = new Map<string, number>();
  return transactions.map((tx) => {
    const dedupeHash = computeDedupeHash(accountId, tx);
    const occurrenceIndex = seen.get(dedupeHash) ?? 0;
    seen.set(dedupeHash, occurrenceIndex + 1);
    return { ...tx, dedupeHash, occurrenceIndex };
  });
}

export function dedupeKey(tx: Pick<KeyedTransaction, "dedupeHash" | "occurrenceIndex">): string {
  return `${tx.dedupeHash}:${tx.occurrenceIndex}`;
}

/** `existingKeys` holds `${hash}:${index}` for the account (loaded by the caller, user-scoped). */
export function partitionByExisting(
  keyed: KeyedTransaction[],
  existingKeys: Set<string>,
): { fresh: KeyedTransaction[]; duplicates: KeyedTransaction[] } {
  const fresh: KeyedTransaction[] = [];
  const duplicates: KeyedTransaction[] = [];
  for (const tx of keyed) {
    (existingKeys.has(dedupeKey(tx)) ? duplicates : fresh).push(tx);
  }
  return { fresh, duplicates };
}
