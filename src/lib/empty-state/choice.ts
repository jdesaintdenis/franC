/** Which empty state a screen shows, decided from counts (pure, so it is unit tested). */

/** Transactions list with no rows: nothing imported yet, or filters that match nothing. */
export function transactionsEmptyKind(hasFilters: boolean): "none" | "noMatch" {
  return hasFilters ? "noMatch" : "none";
}

/** Regular payments' primary action: look for them when there is data to look in, else import. */
export function recurringEmptyAction(transactionCount: number): "detect" | "import" {
  return transactionCount > 0 ? "detect" : "import";
}

/** Year with no data: offer the latest year that has some, when there is one other than this. */
export function yearEmptyAlternative(year: number, latestYear: number | null): number | null {
  return latestYear !== null && latestYear !== year ? latestYear : null;
}
