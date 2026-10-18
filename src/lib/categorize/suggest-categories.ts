import { merchantKey } from "../recurring/merchant-key";
import type { GuessExample } from "./guess";

/** Suggestions shown as pills in the detail sheet. */
export const MAX_SUGGESTIONS = 4;
/** Choices this recent count as "frequent lately". */
const RECENT_DAYS = 90;
const DAY_MS = 86_400_000;

export interface SuggestionTarget {
  merchantId: string | null;
  labelNormalized: string;
  /** ISO date `YYYY-MM-DD`; "recent" is measured back from it. */
  date: string;
}

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

/**
 * The categories to offer first for a row, best first: past choices for the same merchant, then for
 * the same label key, then the ones used most in the last 90 days, then the ones used most overall. Pure: the caller loads the examples.
 */
export function suggestCategories(examples: readonly GuessExample[], target: SuggestionTarget, limit = MAX_SUGGESTIONS): string[] {
  const key = merchantKey(target.labelNormalized);
  const today = dayNumber(target.date);
  const scores = new Map<string, number>();
  // Overall use, so a row with no history still gets the categories you use most.
  const used = new Map<string, number>();
  for (const e of examples) {
    used.set(e.categoryId, (used.get(e.categoryId) ?? 0) + 1);
    let score = 0;
    if (target.merchantId !== null && e.merchantId === target.merchantId) score += 3;
    else if (merchantKey(e.labelNormalized) === key) score += 2;
    const age = today - dayNumber(e.date);
    if (age >= 0 && age <= RECENT_DAYS) score += 1;
    if (score > 0) scores.set(e.categoryId, (scores.get(e.categoryId) ?? 0) + score);
  }
  // Ties go to the id so the order never flickers between loads.
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  const mostUsed = [...used.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  return [...new Set([...ranked, ...mostUsed])].slice(0, limit);
}
