import type { Locale } from "@/i18n/config";

/**
 * Budget cents as text for the amount field: "400", or "400,50" in French / "400.50" in
 * English. Round-trips through `parseBudgetAmount`. Integer math, no thousands separator.
 */
export function formatBudgetInput(cents: number, locale: Locale): string {
  const euros = Math.trunc(cents / 100);
  const rest = cents % 100;
  if (rest === 0) return String(euros);
  return `${euros}${locale === "fr" ? "," : "."}${String(rest).padStart(2, "0")}`;
}
