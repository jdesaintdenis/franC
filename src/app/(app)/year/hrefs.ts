import { monthRange } from "@/lib/dashboard/month";
import { filtersToSearchParams } from "@/lib/transactions/filters";
import { yearRange } from "@/lib/year/year";

/** Year page link; omitted parts stay out of the URL, so the current year is "/year". */
export function yearHref(parts: { year?: number | null; flow?: string | null }): string {
  const params = new URLSearchParams();
  if (parts.year) params.set("year", String(parts.year));
  if (parts.flow && parts.flow !== "year") params.set("flow", parts.flow);
  const query = params.toString();
  return query ? `/year?${query}` : "/year";
}

type Period = { month: string } | { year: number };
const rangeOf = (period: Period) => ("month" in period ? monthRange(period.month) : yearRange(period.year));

/**
 * Transactions list of outflows (transfers hidden, as in every figure of this page) for a
 * month or the whole year, optionally for one category. A parent category's filter already
 * covers its subcategories, which the page's top-level rows include.
 */
export function spendingHref(period: Period, categoryId: string | null | undefined): string {
  const params = filtersToSearchParams({
    ...rangeOf(period),
    ...(categoryId !== undefined ? { category: categoryId ?? "none" } : {}),
    direction: "out",
    transfers: "hide",
  });
  return `/transactions?${params.toString()}`;
}

/** The same for inflows of one income source (a category, or none). */
export function incomeHref(period: Period, categoryId: string | null): string {
  const params = filtersToSearchParams({
    ...rangeOf(period),
    category: categoryId ?? "none",
    direction: "in",
    transfers: "hide",
  });
  return `/transactions?${params.toString()}`;
}
