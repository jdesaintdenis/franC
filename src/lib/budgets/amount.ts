import { parseAmountToCents } from "../import/amount";

/** 10 000 000 EUR, in cents. */
export const MAX_BUDGET_CENTS = 1_000_000_000;

export type BudgetAmountError = "invalid" | "not_positive" | "too_large";

export type BudgetAmountResult =
  | { ok: true; /** Null = empty input = remove the budget. */ cents: number | null }
  | { ok: false; error: BudgetAmountError };

// Whitespace of any kind (incl. no-break and narrow no-break spaces) is a thousands separator.
const WHITESPACE_RE = /[\s  ]+/g;
const SHAPE_RE = /^[+-]?\d+(?:,\d+)?$/;

/**
 * Parses what a user typed in a euro budget field (`400`, `400,5`, `400.50`, `1 200,00`).
 * Returns codes, never text. String arithmetic only, via `parseAmountToCents`.
 */
export function parseBudgetAmount(input: string): BudgetAmountResult {
  const compact = input.replace(WHITESPACE_RE, "");
  if (compact === "") return { ok: true, cents: null };

  // A dot is accepted as decimal separator; two separators of any kind never match SHAPE_RE.
  const normalized = compact.replace(".", ",");
  if (!SHAPE_RE.test(normalized)) return { ok: false, error: "invalid" };
  const decimals = normalized.split(",")[1] ?? "";
  if (decimals.length > 2) return { ok: false, error: "invalid" };

  const cents = parseAmountToCents(normalized);
  if (cents === null) return { ok: false, error: "too_large" };
  if (cents <= 0) return { ok: false, error: "not_positive" };
  if (cents > MAX_BUDGET_CENTS) return { ok: false, error: "too_large" };
  return { ok: true, cents };
}
