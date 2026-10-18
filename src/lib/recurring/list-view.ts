import { z } from "zod";

import type { RecurringInterval } from "./dates";
import { yearlyCents } from "./yearly";

export type RecurringSort = "next" | "yearly";

/** `?category=` value for items whose latest charge has no category. */
export const UNCATEGORIZED = "none";

export interface ViewItem {
  id: string;
  name: string;
  status: "detected" | "confirmed" | "dismissed" | "ended";
  typicalAmountCents: number;
  interval: RecurringInterval;
  /** Category of the item's latest charge (top-level or sub), or null. */
  categoryId: string | null;
}

export interface ViewCategory {
  id: string;
  parentId: string | null;
}

export interface RecurringView {
  /** A category id, `UNCATEGORIZED`, or null for all. */
  category: string | null;
  sort: RecurringSort;
}

const sortSchema = z.enum(["next", "yearly"]);

/**
 * The `?category=` and `?sort=` params. A category that isn't one of the user's own,
 * or a malformed value, is ignored like an invalid `?account=`, so a bad link still
 * renders the full list.
 */
export function parseRecurringView(
  params: { category?: unknown; sort?: unknown },
  ownCategoryIds: readonly string[],
): RecurringView {
  const sort = sortSchema.safeParse(params.sort);
  const category =
    typeof params.category === "string" &&
    (params.category === UNCATEGORIZED || ownCategoryIds.includes(params.category))
      ? params.category
      : null;
  return { category, sort: sort.success ? sort.data : "next" };
}

/** Picking a top-level category also keeps items filed under its subcategories. */
export function filterByCategory<T extends ViewItem>(
  items: readonly T[],
  category: string | null,
  categories: readonly ViewCategory[],
): T[] {
  if (category === null) return [...items];
  if (category === UNCATEGORIZED) return items.filter((i) => i.categoryId === null);
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  return items.filter(
    (i) => i.categoryId !== null && (i.categoryId === category || parentOf.get(i.categoryId) === category),
  );
}

/**
 * "next" keeps the server order (confirmed first, then soonest due). "yearly" puts the
 * largest yearly outflow first and income last (yearly cost is signed), ties by name.
 */
export function sortItems<T extends ViewItem>(items: readonly T[], sort: RecurringSort): T[] {
  if (sort === "next") return [...items];
  return [...items].sort(
    (a, b) =>
      yearlyCents(a.typicalAmountCents, a.interval) - yearlyCents(b.typicalAmountCents, b.interval) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export interface YearlyTotals {
  /** What confirmed outflows cost per year, as a positive magnitude in cents. */
  confirmedOutCents: number;
  /** The same for detected outflows, still to review. */
  detectedOutCents: number;
  detectedOutCount: number;
}

/** Yearly cost of the recurring outflows still running. Income, ended and dismissed items don't count. */
export function yearlyTotals(items: readonly ViewItem[]): YearlyTotals {
  const totals: YearlyTotals = { confirmedOutCents: 0, detectedOutCents: 0, detectedOutCount: 0 };
  for (const item of items) {
    if (item.typicalAmountCents >= 0) continue;
    const cost = -yearlyCents(item.typicalAmountCents, item.interval);
    if (item.status === "confirmed") totals.confirmedOutCents += cost;
    else if (item.status === "detected") {
      totals.detectedOutCents += cost;
      totals.detectedOutCount++;
    }
  }
  return totals;
}

export interface RegularTotals {
  /** Confirmed running outflows per month, positive cents (floor of the yearly sum / 12). */
  confirmedMonthlyOutCents: number;
  confirmedYearlyOutCents: number;
  confirmedOutCount: number;
  /** Confirmed running inflows per month. */
  confirmedMonthlyInCents: number;
  /** Detected items, either direction: what the "À confirmer" block holds. */
  toConfirmCount: number;
  /** Detected outflows per month (the block's "par mois au total"). */
  detectedMonthlyOutCents: number;
}

/** Headline numbers: confirmed items only; detected ones are counted apart, ended and dismissed not at all. */
export function regularTotals(items: readonly ViewItem[]): RegularTotals {
  let outYear = 0;
  let outCount = 0;
  let inYear = 0;
  let detectedOutYear = 0;
  let toConfirmCount = 0;
  for (const item of items) {
    if (item.status !== "confirmed" && item.status !== "detected") continue;
    const yearly = yearlyCents(item.typicalAmountCents, item.interval);
    if (item.status === "detected") {
      toConfirmCount++;
      if (yearly < 0) detectedOutYear -= yearly;
    } else if (yearly < 0) {
      outYear -= yearly;
      outCount++;
    } else {
      inYear += yearly;
    }
  }
  return {
    confirmedMonthlyOutCents: Math.floor(outYear / 12),
    confirmedYearlyOutCents: outYear,
    confirmedOutCount: outCount,
    confirmedMonthlyInCents: Math.floor(inYear / 12),
    toConfirmCount,
    detectedMonthlyOutCents: Math.floor(detectedOutYear / 12),
  };
}

/**
 * Ids of the categories worth offering in the filter: those items use, plus their
 * parents (so a top-level category can gather its subcategories). Whether
 * "Uncategorized" is offered is `hasUncategorized`.
 */
export function usedCategoryIds(
  items: readonly ViewItem[],
  categories: readonly ViewCategory[],
): { ids: Set<string>; hasUncategorized: boolean } {
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  const ids = new Set<string>();
  let hasUncategorized = false;
  for (const item of items) {
    if (item.categoryId === null) {
      hasUncategorized = true;
      continue;
    }
    ids.add(item.categoryId);
    const parent = parentOf.get(item.categoryId);
    if (parent) ids.add(parent);
  }
  return { ids, hasUncategorized };
}

/** The page URL for an account and view; the default sort is left out so links stay short. */
export function recurringHref(accountId: string | null, view: RecurringView): string {
  const params = new URLSearchParams();
  if (accountId) params.set("account", accountId);
  if (view.category) params.set("category", view.category);
  if (view.sort !== "next") params.set("sort", view.sort);
  const query = params.toString();
  return query ? `/recurring?${query}` : "/recurring";
}
