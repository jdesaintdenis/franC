import type { Locale } from "@/i18n/config";
import { coveredCategoryIds, type CategoryNode } from "@/lib/categorize/hierarchy";

/** What the transactions list is filtered by, reduced to what split rows need. */
export type SplitCategoryFilter = { kind: "none" } | { kind: "categories"; ids: string[] };

/**
 * The list's `category` URL param as a filter over split parts. A parent id also covers its
 * subcategories, like the server-side filter. Null when the list is not filtered by category.
 */
export function splitCategoryFilter(
  param: string | undefined,
  categories: readonly CategoryNode[],
): SplitCategoryFilter | null {
  if (param === undefined) return null;
  if (param === "none") return { kind: "none" };
  return { kind: "categories", ids: coveredCategoryIds(categories, param) };
}

/** The parts a category filter matches: same rule as the server (`none` = a part without category). */
export function matchingSplitParts<P extends { category: { id: string } | null }>(
  parts: readonly P[],
  filter: SplitCategoryFilter | null,
): P[] {
  if (filter === null) return [];
  if (filter.kind === "none") return parts.filter((p) => p.category === null);
  const ids = new Set(filter.ids);
  return parts.filter((p) => p.category !== null && ids.has(p.category.id));
}

/**
 * Absolute cents as text for the amount field: "44,50" in French, "44.50" in English. Always two
 * decimals so the field reads as money; the parser accepts both separators.
 */
export function centsToEuroInput(absCents: number, locale: Locale): string {
  const abs = Math.abs(absCents);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${whole}${locale === "fr" ? "," : "."}${fraction}`;
}

export type RemainderState =
  | { kind: "balanced" }
  /** Parts fall short of the total by `cents` (absolute). */
  | { kind: "left"; cents: number }
  /** Parts exceed the total by `cents` (absolute). */
  | { kind: "over"; cents: number };

/** Turns the signed remainder (total minus parts) into a direction-free state for display. */
export function remainderState(totalCents: number, remainderCents: number): RemainderState {
  if (remainderCents === 0) return { kind: "balanced" };
  const cents = Math.abs(remainderCents);
  return Math.sign(remainderCents) === Math.sign(totalCents) ? { kind: "left", cents } : { kind: "over", cents };
}
