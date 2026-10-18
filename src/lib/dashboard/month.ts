import { z } from "zod";

import { formattingLocale, type Locale } from "@/i18n/config";

import { daysInMonth, filtersToSearchParams } from "../transactions/filters";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthSchema = z.string().regex(MONTH_RE);

export interface MonthRange {
  from: string;
  to: string;
}

export interface TrendPoint {
  month: string;
  spentCents: number;
  incomeCents: number;
}

/**
 * The calendar month ("YYYY-MM") that `now` falls in for the given zone. The
 * only place a `Date` is used: the zone decides which month it is, and
 * formatToParts avoids re-parsing a formatted string.
 */
export function currentMonth(now: Date, timeZone = "Europe/Paris"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}`;
}

/** Today's date ("YYYY-MM-DD") in the given zone; same approach as `currentMonth`. */
export function currentDate(now: Date, timeZone = "Europe/Paris"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

/** Never throws: anything that is not a single valid "YYYY-MM" yields the fallback. */
export function parseMonthParam(value: string | string[] | undefined, fallback: string): string {
  const result = monthSchema.safeParse(value);
  return result.success ? result.data : fallback;
}

function split(month: string): { year: number; monthNumber: number } {
  return { year: Number(month.slice(0, 4)), monthNumber: Number(month.slice(5, 7)) };
}

function join(year: number, monthNumber: number): string {
  return `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
}

/** Month arithmetic on a zero-based month index so negative `n` and year rollover just work. */
export function addMonths(month: string, n: number): string {
  const { year, monthNumber } = split(month);
  const index = year * 12 + (monthNumber - 1) + n;
  const newYear = Math.floor(index / 12);
  return join(newYear, index - newYear * 12 + 1);
}

/** Inclusive first and last day of the month. */
export function monthRange(month: string): MonthRange {
  const { year, monthNumber } = split(month);
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(year, monthNumber)).padStart(2, "0")}` };
}

/** `count` consecutive months ending at `month`, oldest first. */
export function monthsEnding(month: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(month, i - (count - 1)));
}

// Built at UTC midnight and formatted in UTC so the month can't shift with the runtime zone.
function monthDate(month: string): Date {
  const { year, monthNumber } = split(month);
  return new Date(Date.UTC(year, monthNumber - 1, 1));
}

const monthFormats = new Map<string, Intl.DateTimeFormat>();

function monthFormat(locale: Locale, style: "long" | "short" | "name"): Intl.DateTimeFormat {
  const key = `${locale}:${style}`;
  let f = monthFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(
      formattingLocale(locale),
      style === "long"
        ? { month: "long", year: "numeric", timeZone: "UTC" }
        : { month: style === "name" ? "long" : "short", timeZone: "UTC" },
    );
    monthFormats.set(key, f);
  }
  return f;
}

/** "2025-09" -> "September 2025" / "Septembre 2025" (capitalized: it's used as a heading). */
export function formatMonthLabel(month: string, locale: Locale): string {
  const label = monthFormat(locale, "long").format(monthDate(month));
  return label.charAt(0).toLocaleUpperCase(formattingLocale(locale)) + label.slice(1);
}

/** "2025-09" -> "September" / "Septembre": the month alone, for sentences that start with it. */
export function formatMonthName(month: string, locale: Locale): string {
  const label = monthFormat(locale, "name").format(monthDate(month));
  return label.charAt(0).toLocaleUpperCase(formattingLocale(locale)) + label.slice(1);
}

/** A month label or name inside a sentence: French writes months in lower case, English keeps the capital. */
export function inSentence(label: string, locale: Locale): string {
  return locale === "fr" ? label.toLocaleLowerCase("fr") : label;
}

/** "2025-09" -> "Sep" / "sept.", for chart axes. */
export function formatShortMonthLabel(month: string, locale: Locale): string {
  return monthFormat(locale, "short").format(monthDate(month));
}

/** One point per requested month, in that order; months without rows are zero. */
export function fillTrend(rows: TrendPoint[], months: string[]): TrendPoint[] {
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return months.map((month) => byMonth.get(month) ?? { month, spentCents: 0, incomeCents: 0 });
}

/** Link to the Transactions list filtered to one category's outflows in a month. */
export function categoryDrillDownHref(month: string, categoryId: string | null, accountId?: string | null): string {
  const { from, to } = monthRange(month);
  const params = filtersToSearchParams({
    from,
    to,
    category: categoryId ?? "none",
    direction: "out",
    // The chart excludes internal transfers, so the list must too.
    transfers: "hide",
    ...(accountId ? { account: accountId } : {}),
  });
  return `/transactions?${params.toString()}`;
}

/** Link to the month's internal transfers on the Transactions list. */
export function monthTransfersHref(month: string, accountId?: string | null): string {
  const { from, to } = monthRange(month);
  const params = filtersToSearchParams({ from, to, direction: "all", transfers: "only", ...(accountId ? { account: accountId } : {}) });
  return `/transactions?${params.toString()}`;
}

const categoryParamSchema = z.string().uuid();

/** The `?category=` param as a category id, or null when missing or malformed. */
export function parseCategoryParam(value: unknown): string | null {
  const parsed = categoryParamSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Dashboard link to a top-level category's subcategory breakdown for a month. */
export function subcategoryBreakdownHref(month: string, parentId: string, accountId?: string | null): string {
  return dashboardHref({ month, category: parentId, account: accountId });
}

/**
 * Dashboard link for a month and optional category / account. Omitted parts
 * stay out of the URL, so the plain "this month" link is "/budget".
 */
export function dashboardHref(parts: { month?: string | null; category?: string | null; account?: string | null }): string {
  const params = new URLSearchParams();
  if (parts.month) params.set("month", parts.month);
  if (parts.category) params.set("category", parts.category);
  if (parts.account) params.set("account", parts.account);
  const query = params.toString();
  return query ? `/budget?${query}` : "/budget";
}
