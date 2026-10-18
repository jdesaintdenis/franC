import { compileMatcher, type RuleLabels, type RuleMatchType } from "../categorize/rules";
import { SUGGESTION_MIN_KEY_LENGTH } from "../categorize/suggest-rule";
import { merchantKey } from "../recurring/merchant-key";

export interface SavingsRuleInput {
  id: string;
  accountId: string;
  goalId: string | null;
  matchType: RuleMatchType;
  pattern: string;
  createdAt: Date;
}

/**
 * The pattern a "move payments like this" rule uses: the merchant's name, else the label's merchant key
 * (the same choice `proposeRule` makes). Null when it is too short to be safe.
 */
export function savingsRulePattern(merchantName: string | null, labelNormalized: string): string | null {
  const name = merchantName?.trim() ?? "";
  const pattern = name !== "" ? name : merchantKey(labelNormalized);
  return pattern.length >= SUGGESTION_MIN_KEY_LENGTH ? pattern : null;
}

/**
 * The Savings account (and goal, if the rule has one) a freshly inserted row moves to, or null. Rules apply oldest first; a rule never
 * touches a row that existed before it (`row.createdAt < rule.createdAt`).
 */
export function matchSavingsRule(
  rules: readonly SavingsRuleInput[],
  row: { createdAt: Date; labels: RuleLabels },
): { accountId: string; goalId: string | null } | null {
  const ordered = [...rules].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const rule of ordered) {
    if (row.createdAt.getTime() >= rule.createdAt.getTime() && compileMatcher(rule)(row.labels)) return { accountId: rule.accountId, goalId: rule.goalId };
  }
  return null;
}
