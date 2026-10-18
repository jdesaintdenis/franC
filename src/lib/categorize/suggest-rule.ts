import { merchantKey } from "../recurring/merchant-key";
import type { CompiledRule } from "./rules";

/** Hand categorizations of one merchant in one category before a rule is suggested. */
export const SUGGESTION_MIN_ROWS = 3;
export const SUGGESTION_LIMIT = 10;
/** Shorter keys would match too many labels with "contains". */
export const SUGGESTION_MIN_KEY_LENGTH = 3;

/** A manually categorized row. */
export interface SuggestionRow {
  categoryId: string;
  merchantId: string | null;
  /** The merchant's name, when the row has one. */
  merchantName: string | null;
  labelNormalized: string;
  labelDisplay?: string | null;
}

export interface RuleSuggestion {
  matchType: "equals" | "contains";
  pattern: string;
  categoryId: string;
  /** Hand categorizations behind the suggestion. */
  count: number;
  /** Set for merchant groups: the pattern is the merchant's name. */
  merchantId: string | null;
}

export interface SuggestionDismissal {
  matchType: string;
  pattern: string;
  categoryId: string;
}

function groupKey(row: SuggestionRow): string {
  return row.merchantId !== null ? `m:${row.merchantId}` : `k:${merchantKey(row.labelNormalized)}`;
}

function evaluateGroup(
  rows: readonly SuggestionRow[],
  rules: readonly CompiledRule[],
  dismissals: readonly SuggestionDismissal[],
): RuleSuggestion | null {
  if (rows.length < SUGGESTION_MIN_ROWS) return null;
  const categoryId = rows[0].categoryId;
  // A conflicting hand choice means there is no consistent habit to turn into a rule.
  if (rows.some((r) => r.categoryId !== categoryId)) return null;

  const first = rows[0];
  const suggestion: RuleSuggestion =
    first.merchantId !== null && first.merchantName
      ? { matchType: "equals", pattern: first.merchantName, categoryId, count: rows.length, merchantId: first.merchantId }
      : { matchType: "contains", pattern: merchantKey(first.labelNormalized), categoryId, count: rows.length, merchantId: null };
  if (suggestion.matchType === "contains" && suggestion.pattern.length < SUGGESTION_MIN_KEY_LENGTH) return null;

  const covered = rows.some((r) =>
    rules.some((rule) =>
      rule.matches({ normalized: r.labelNormalized, display: r.labelDisplay ?? null, merchant: r.merchantName }),
    ),
  );
  if (covered) return null;
  if (
    dismissals.some(
      (d) => d.matchType === suggestion.matchType && d.pattern === suggestion.pattern && d.categoryId === categoryId,
    )
  ) {
    return null;
  }
  return suggestion;
}

function groupRows(rows: readonly SuggestionRow[]): Map<string, SuggestionRow[]> {
  const groups = new Map<string, SuggestionRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/** Every current suggestion, biggest group first (ties by pattern), at most `limit`. */
export function suggestRules(
  manualRows: readonly SuggestionRow[],
  rules: readonly CompiledRule[],
  dismissals: readonly SuggestionDismissal[],
  limit = SUGGESTION_LIMIT,
): RuleSuggestion[] {
  const found: RuleSuggestion[] = [];
  for (const rows of groupRows(manualRows).values()) {
    const s = evaluateGroup(rows, rules, dismissals);
    if (s) found.push(s);
  }
  found.sort((a, b) => b.count - a.count || (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0));
  return found.slice(0, limit);
}

/** The suggestion the group of `row` qualifies for now, if any. `manualRows` should include `row`. */
export function suggestionForRow(
  row: SuggestionRow,
  manualRows: readonly SuggestionRow[],
  rules: readonly CompiledRule[],
  dismissals: readonly SuggestionDismissal[],
): RuleSuggestion | null {
  const key = groupKey(row);
  return evaluateGroup(
    manualRows.filter((r) => groupKey(r) === key),
    rules,
    dismissals,
  );
}
