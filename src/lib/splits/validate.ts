import { parseEuroInput } from "../transactions/filters";

export const MIN_SPLIT_PARTS = 2;
export const MAX_SPLIT_PARTS = 20;

/** Codes, never user-facing text: the UI translates them. */
export type SplitErrorCode =
  | "too_few_parts"
  | "too_many_parts"
  | "missing_category"
  | "invalid_amount"
  | "sum_mismatch";

export interface SplitPartInput {
  categoryId: string | null;
  /** Signed integer cents, same sign as the transaction. */
  amountCents: number;
}

export type SplitValidation = { ok: true } | { ok: false; error: SplitErrorCode };

/**
 * Checks a split against its transaction: 2 to 20 parts, each with a category and a
 * non-zero amount of the transaction's sign, summing exactly to the transaction. The same
 * sign keeps per-category figures consistent with the month totals, which stay on whole rows.
 */
export function validateSplit(totalCents: number, parts: readonly SplitPartInput[]): SplitValidation {
  if (parts.length < MIN_SPLIT_PARTS) return { ok: false, error: "too_few_parts" };
  if (parts.length > MAX_SPLIT_PARTS) return { ok: false, error: "too_many_parts" };

  for (const part of parts) {
    if (part.categoryId === null) return { ok: false, error: "missing_category" };
  }
  const sign = Math.sign(totalCents);
  for (const part of parts) {
    if (!Number.isSafeInteger(part.amountCents) || part.amountCents === 0 || Math.sign(part.amountCents) !== sign) {
      return { ok: false, error: "invalid_amount" };
    }
  }
  if (splitRemainder(totalCents, parts) !== 0) return { ok: false, error: "sum_mismatch" };
  return { ok: true };
}

/**
 * What is left to assign: positive when parts fall short of the total, negative when they
 * exceed it (same sign convention as the amounts), zero when exact.
 */
export function splitRemainder(totalCents: number, parts: readonly { amountCents: number }[]): number {
  return totalCents - parts.reduce((sum, p) => sum + p.amountCents, 0);
}

/**
 * Euro text typed in the editor (`12`, `12,50`, `12.50`, always positive) to signed cents,
 * taking the sign from the transaction. Null when the text is not an amount. Reuses the
 * filter parser so string arithmetic stays the only path from text to money.
 */
export function euroInputToSignedCents(input: string, transactionCents: number): number | null {
  const cents = parseEuroInput(input);
  if (cents === null) return null;
  if (cents === 0) return 0; // avoid -0
  return transactionCents < 0 ? -cents : cents;
}
