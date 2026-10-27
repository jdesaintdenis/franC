import type { CategorySpending } from "@/db/queries/dashboard";
import type { Locale } from "@/i18n/config";
import { addMonths, formatMonthLabel, formatMonthName, formatShortMonthLabel, inSentence, parseMonthParam } from "@/lib/dashboard/month";

/** The two months of the Compare page: `a` is the one being looked at, `b` the one set against it. */
export interface ComparedMonths {
  a: string;
  b: string;
}

/**
 * Never throws (SPEC §89 D2): a missing or invalid `a` is the current month, `b` defaults to the month
 * before `a`; months after the current one are pulled back to it, and the same month twice falls back
 * to the month before for `b`.
 */
export function parseCompareParams(params: { a?: string | string[]; b?: string | string[] }, current: string): ComparedMonths {
  const clamp = (month: string) => (month > current ? current : month);
  const a = clamp(parseMonthParam(params.a, current));
  const b = clamp(parseMonthParam(params.b, addMonths(a, -1)));
  return { a, b: b === a ? addMonths(a, -1) : b };
}

export function compareHref({ a, b }: ComparedMonths): string {
  return `/budget/compare?${new URLSearchParams({ a, b })}`;
}

export interface CategoryComparison {
  /** categoryId, or "none" for the uncategorized bucket. */
  key: string;
  categoryId: string | null;
  /** Null = money without a category; the page labels it. */
  name: string | null;
  color: string;
  icon: string | null;
  aCents: number;
  bCents: number;
  /** aCents - bCents: negative means less spent in A. */
  diffCents: number;
}

/** Every top-level category spent in either month, biggest change first (ties: more spent in A, then by name). */
export function compareCategories(a: readonly CategorySpending[], b: readonly CategorySpending[]): CategoryComparison[] {
  const rows = new Map<string, CategoryComparison>();
  const add = (list: readonly CategorySpending[], side: "aCents" | "bCents") => {
    for (const c of list) {
      const key = c.categoryId ?? "none";
      const row = rows.get(key) ?? { key, categoryId: c.categoryId, name: c.name, color: c.color, icon: c.icon, aCents: 0, bCents: 0, diffCents: 0 };
      row[side] += c.spentCents;
      rows.set(key, row);
    }
  };
  // A first, so a category's name, colour and icon come from the month being looked at.
  add(a, "aCents");
  add(b, "bCents");
  return [...rows.values()]
    .map((r) => ({ ...r, diffCents: r.aCents - r.bCents }))
    .sort(
      (x, y) =>
        Math.abs(y.diffCents) - Math.abs(x.diffCents) ||
        y.aCents - x.aCents ||
        (x.name === null ? 1 : y.name === null ? -1 : x.name.localeCompare(y.name)),
    );
}

/** (a - b) / b, or null when there is nothing to compare against or nothing changed. */
export function changeRatio(aCents: number, bCents: number): number | null {
  return bCents === 0 || aCents === bCents ? null : (aCents - bCents) / bCents;
}

/** Spending less is good; for income and net, more is. */
export function changeTone(diffCents: number, higherIsGood: boolean): "positive" | "warning" | "same" {
  if (diffCents === 0) return "same";
  return diffCents > 0 === higherIsGood ? "positive" : "warning";
}

/** Whole percent of a budget spent, half up; null for a budget of zero or less. */
export function budgetSharePercent(spentCents: number, budgetCents: number): number | null {
  return budgetCents > 0 ? Math.round((spentCents * 100) / budgetCents) : null;
}

export interface MonthNames {
  /** For sentences: "juillet", or "juillet 2025" when the two months are in different years. */
  sentence: string;
  /** For table headers and pills: "juil.", or "juil. 2025" across years. */
  header: string;
}

/** SPEC §89 D5: the year is only spelled out when the two months need it to be told apart. */
export function monthNames({ a, b }: ComparedMonths, locale: Locale): { a: MonthNames; b: MonthNames } {
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  const names = (month: string): MonthNames => ({
    sentence: inSentence(sameYear ? formatMonthName(month, locale) : formatMonthLabel(month, locale), locale),
    header: sameYear ? formatShortMonthLabel(month, locale) : `${formatShortMonthLabel(month, locale)} ${month.slice(0, 4)}`,
  });
  return { a: names(a), b: names(b) };
}
