import type { Decision } from "../bank-sync/match";
import { partitionByExisting } from "./dedupe";
import type { KeyedTransaction, RowError } from "./types";

export interface ImportPlan {
  /** `new` includes the `possible` rows: they are inserted too, for the user to review. */
  counts: { total: number; new: number; duplicate: number; possible: number; error: number };
  fresh: KeyedTransaction[];
  errors: RowError[];
}

/**
 * Pure: combines parsed rows with what is already stored into the preview numbers. Either the stored
 * hash keys (same-hash duplicates only), or the matcher's per-row verdicts, which also catch rows a
 * bank sync brought in under another label and mark rows that may duplicate several existing ones.
 */
export function buildImportPlan(
  prepared: { transactions: KeyedTransaction[]; errors: RowError[]; rowsTotal: number },
  existing: Set<string> | readonly Decision[],
): ImportPlan {
  let fresh: KeyedTransaction[];
  let duplicate: number;
  let possible = 0;
  if (existing instanceof Set) {
    const parts = partitionByExisting(prepared.transactions, existing);
    fresh = parts.fresh;
    duplicate = parts.duplicates.length;
  } else {
    fresh = prepared.transactions.filter((_, i) => existing[i].kind === "insert" || existing[i].kind === "possible");
    duplicate = prepared.transactions.length - fresh.length;
    possible = existing.filter((d) => d.kind === "possible").length;
  }
  return {
    counts: {
      total: prepared.rowsTotal,
      new: fresh.length,
      duplicate,
      possible,
      error: prepared.errors.length,
    },
    fresh,
    errors: prepared.errors,
  };
}

/** First `n` rows to show in the preview. */
export function sampleRows(fresh: KeyedTransaction[], n = 10): KeyedTransaction[] {
  return fresh.slice(0, n);
}

/** Earliest and latest date of `rows` (ISO strings compare chronologically), or null when empty. */
export function dateRangeOf(rows: readonly { date: string }[]): { from: string; to: string } | null {
  let from: string | null = null;
  let to: string | null = null;
  for (const { date } of rows) {
    if (from === null || date < from) from = date;
    if (to === null || date > to) to = date;
  }
  return from !== null && to !== null ? { from, to } : null;
}

/** Money in, money out (≤ 0) and the net of `rows`, in integer cents. */
export function cashFlows(rows: readonly { amountCents: number }[]): { inCents: number; outCents: number; netCents: number } {
  let inCents = 0;
  let outCents = 0;
  for (const { amountCents } of rows) {
    if (amountCents > 0) inCents += amountCents;
    else outCents += amountCents;
  }
  return { inCents, outCents, netCents: inCents + outCents };
}
