import type { Locale } from "@/i18n/config";

import { parseAmountToCents } from "../import/amount";

/** 10 000 000 EUR, in cents; same bound as budgets. Applies to the absolute value. */
export const MAX_BALANCE_CENTS = 1_000_000_000;

export type BalanceAmountError = "invalid" | "too_large";

export type BalanceAmountResult =
  | { ok: true; /** Null = empty input. */ cents: number | null }
  | { ok: false; error: BalanceAmountError };

export type ThresholdAmountResult =
  | { ok: true; cents: number }
  | { ok: false; error: BalanceAmountError };

// Whitespace of any kind (incl. no-break and narrow no-break spaces) is a thousands separator.
const WHITESPACE_RE = /[\s  ]+/g;
const SHAPE_RE = /^[+-]?\d+(?:,\d+)?$/;

/**
 * Parses a signed euro amount typed by a user (`-120,50`, `1 234,56`, `1234.56`, `+5`).
 * Empty input gives `cents: null`. Returns codes, never text. Zero is allowed.
 */
export function parseBalanceAmount(input: string): BalanceAmountResult {
  const compact = input.replace(WHITESPACE_RE, "");
  if (compact === "") return { ok: true, cents: null };

  const normalized = compact.replace(".", ",");
  if (!SHAPE_RE.test(normalized)) return { ok: false, error: "invalid" };
  const decimals = normalized.split(",")[1] ?? "";
  if (decimals.length > 2) return { ok: false, error: "invalid" };

  const cents = parseAmountToCents(normalized);
  if (cents === null) return { ok: false, error: "too_large" };
  if (Math.abs(cents) > MAX_BALANCE_CENTS) return { ok: false, error: "too_large" };
  // Normalizes -0 so equality checks and DB writes never see it.
  return { ok: true, cents: cents === 0 ? 0 : cents };
}

/** Like `parseBalanceAmount`, but empty input means the default threshold, 0. */
export function parseThresholdAmount(input: string): ThresholdAmountResult {
  const parsed = parseBalanceAmount(input);
  if (!parsed.ok) return parsed;
  return { ok: true, cents: parsed.cents ?? 0 };
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written "YYYY-MM-DD" (rejects 2026-02-30). */
export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  // UTC so the local time zone can never shift the day.
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Signed cents as text for an amount field: "-120,50" in French / "-120.50" in English.
 * Round-trips through `parseBalanceAmount`. Integer math, no thousands separator.
 */
export function formatBalanceInput(cents: number, locale: Locale): string {
  const abs = Math.abs(cents);
  const euros = Math.trunc(abs / 100);
  const rest = abs % 100;
  const sign = cents < 0 ? "-" : "";
  if (rest === 0) return `${sign}${euros}`;
  return `${sign}${euros}${locale === "fr" ? "," : "."}${String(rest).padStart(2, "0")}`;
}
