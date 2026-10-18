import { z } from "zod";

import { parseAmountToCents } from "../import/amount";

export type Direction = "all" | "out" | "in";
export type TransferFilter = "hide" | "only";
export type IgnoredFilter = "show" | "only";

export interface TransactionFilters {
  /** Trimmed search text, 1-100 chars. */
  q?: string;
  /** Inclusive YYYY-MM-DD bounds. */
  from?: string;
  to?: string;
  /** Category uuid, or "none" for uncategorized only. */
  category?: string;
  /** Account uuid. */
  account?: string;
  /** Merchant uuid: only rows carrying that merchant name. */
  merchant?: string;
  /** Tag uuid: only rows carrying that tag. */
  tag?: string;
  /** Absolute amounts in integer cents, >= 0. */
  min?: number;
  max?: number;
  direction: Direction;
  /** "hide" drops rows in an internal transfer, "only" keeps just those; unset shows all. */
  transfers?: TransferFilter;
  /** Unset hides ignored rows; "show" lists them with the others, "only" keeps just those. */
  ignored?: IgnoredFilter;
  /** "todo" keeps only the rows still to review (the À valider rows). */
  review?: "todo";
}

export interface Cursor {
  date: string;
  id: string;
}

// The DB column is a 32-bit integer; a larger bound could never match and
// would make Postgres reject the comparison parameter.
const MAX_CENTS = 2_147_483_647;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Deliberately version-agnostic: we only need to reject junk, not validate UUID versions.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Last day of a month by arithmetic: going through `Date` could shift the day. */
export function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Calendar check by arithmetic: going through `Date` could shift the day. */
function isRealDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

const DAY_FIRST_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

/**
 * A typed day to ISO: DD/MM/YYYY (also D/M/YYYY, separators / . -) or YYYY-MM-DD. Day-first
 * because both app locales are. Null for junk and impossible dates; string arithmetic only.
 */
export function parseDayInput(text: string): string | null {
  const trimmed = text.trim();
  if (isRealDate(trimmed)) return trimmed;
  const match = DAY_FIRST_RE.exec(trimmed);
  if (!match) return null;
  const iso = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return isRealDate(iso) ? iso : null;
}

/** ISO day to the typed day-first form: "2026-09-28" -> "28/09/2026". Anything else is returned as is. */
export function formatDayInput(iso: string): string {
  const match = DATE_RE.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseToday(today: string): { year: number; month: number } {
  const match = DATE_RE.exec(today);
  if (!match) throw new Error("today must be YYYY-MM-DD");
  return { year: Number(match[1]), month: Number(match[2]) };
}

function monthStart(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`;
}

function monthEnd(year: number, month: number): string {
  return `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;
}

/** The calendar month containing `today`, as inclusive ISO bounds. */
export function monthRange(today: string): { from: string; to: string } {
  const { year, month } = parseToday(today);
  return { from: monthStart(year, month), to: monthEnd(year, month) };
}

export type PeriodPreset = "thisMonth" | "lastMonth" | "last3Months" | "thisYear";

/** Inclusive ISO bounds of a period preset relative to `today` (string arithmetic, no Date). */
export function periodPreset(preset: PeriodPreset, today: string): { from: string; to: string } {
  const { year, month } = parseToday(today);
  const back = (months: number) => {
    const index = year * 12 + (month - 1) - months;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  };
  switch (preset) {
    case "thisMonth":
      return monthRange(today);
    case "lastMonth": {
      const m = back(1);
      return { from: monthStart(m.year, m.month), to: monthEnd(m.year, m.month) };
    }
    case "last3Months": {
      const m = back(2);
      return { from: monthStart(m.year, m.month), to: monthEnd(year, month) };
    }
    case "thisYear":
      return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
}

/**
 * The query string ("?a=b" or "") for the canonical params with `changes` applied: a string
 * sets that param, null removes it. Pure so chips can be plain links that work without JS.
 */
export function withParams(canonical: URLSearchParams, changes: Record<string, string | null>): string {
  const params = new URLSearchParams(canonical);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
const uuidSchema = z.string().regex(UUID_RE);
const querySchema = z.string().trim().min(1).max(100);
const categorySchema = z.union([z.literal("none"), uuidSchema]);
const directionSchema = z.enum(["all", "out", "in"]);
const transfersSchema = z.enum(["hide", "only"]);
const ignoredSchema = z.enum(["show", "only"]);
const reviewSchema = z.literal("todo");

/**
 * Euro text ("12", "12,5", "12.50") to non-negative integer cents. String
 * arithmetic via `parseAmountToCents`; signs are rejected because the filter
 * compares absolute amounts and has a separate direction control.
 */
export function parseEuroInput(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d/.test(trimmed)) return null;
  const cents = parseAmountToCents(trimmed.replace(".", ","));
  if (cents === null || cents < 0 || cents > MAX_CENTS) return null;
  return cents;
}

/** Integer cents to URL euro text: 1250 -> "12,50", 1200 -> "12". */
function formatEuroInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const remainder = cents % 100;
  if (remainder === 0) return String(whole);
  return `${whole},${String(remainder).padStart(2, "0")}`;
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseWith<T>(schema: z.ZodType<T>, value: string | undefined): T | undefined {
  if (value === undefined) return undefined;
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

/**
 * Never throws: an invalid param is treated as unset so that a bad URL still
 * renders the list.
 */
export function parseTransactionFilters(
  sp: Record<string, string | string[] | undefined>,
): TransactionFilters {
  const filters: TransactionFilters = { direction: parseWith(directionSchema, single(sp.direction)) ?? "all" };

  const q = parseWith(querySchema, single(sp.q));
  if (q !== undefined) filters.q = q;
  // Day-first text is accepted too so the no-JS filter form works; canonical params stay ISO.
  const rawFrom = single(sp.from);
  const from = rawFrom === undefined ? null : parseDayInput(rawFrom);
  if (from !== null) filters.from = from;
  const rawTo = single(sp.to);
  const to = rawTo === undefined ? null : parseDayInput(rawTo);
  if (to !== null) filters.to = to;
  const category = parseWith(categorySchema, single(sp.category));
  if (category !== undefined) filters.category = category;
  const account = parseWith(uuidSchema, single(sp.account));
  if (account !== undefined) filters.account = account;
  const merchant = parseWith(uuidSchema, single(sp.merchant));
  if (merchant !== undefined) filters.merchant = merchant;
  const tag = parseWith(uuidSchema, single(sp.tag));
  if (tag !== undefined) filters.tag = tag;

  const transfers = parseWith(transfersSchema, single(sp.transfers));
  if (transfers !== undefined) filters.transfers = transfers;
  const ignored = parseWith(ignoredSchema, single(sp.ignored));
  if (ignored !== undefined) filters.ignored = ignored;
  const review = parseWith(reviewSchema, single(sp.review));
  if (review !== undefined) filters.review = review;

  const rawMin = single(sp.min);
  const rawMax = single(sp.max);
  let min = rawMin === undefined ? null : parseEuroInput(rawMin);
  let max = rawMax === undefined ? null : parseEuroInput(rawMax);
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  if (min !== null) filters.min = min;
  if (max !== null) filters.max = max;

  return filters;
}

/** Canonical URL params: omits unset values and the default direction. */
export function filtersToSearchParams(f: TransactionFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.category) params.set("category", f.category);
  if (f.account) params.set("account", f.account);
  if (f.merchant) params.set("merchant", f.merchant);
  if (f.tag) params.set("tag", f.tag);
  if (f.min !== undefined) params.set("min", formatEuroInput(f.min));
  if (f.max !== undefined) params.set("max", formatEuroInput(f.max));
  if (f.direction !== "all") params.set("direction", f.direction);
  if (f.transfers) params.set("transfers", f.transfers);
  if (f.ignored) params.set("ignored", f.ignored);
  if (f.review) params.set("review", f.review);
  return params;
}

const cursorSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}_[0-9a-f-]{36}$/i);

export function encodeCursor(c: Cursor): string {
  return `${c.date}_${c.id}`;
}

/** Returns null for anything that is not a well-formed cursor (it comes from the client). */
export function decodeCursor(s: string): Cursor | null {
  if (!cursorSchema.safeParse(s).success) return null;
  const date = s.slice(0, 10);
  const id = s.slice(11);
  if (!isRealDate(date) || !UUID_RE.test(id)) return null;
  return { date, id };
}
