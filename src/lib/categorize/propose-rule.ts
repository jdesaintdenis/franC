import { merchantKey } from "../recurring/merchant-key";
import { categorizeLabel, type CompiledRule } from "./rules";
import { SUGGESTION_MIN_KEY_LENGTH } from "./suggest-rule";

export interface ProposeRuleInput {
  merchantName: string | null;
  labelNormalized: string;
  labelDisplay?: string | null;
  /** The category the user just picked by hand. */
  categoryId: string;
}

export interface RuleProposal {
  matchType: "contains";
  pattern: string;
  categoryId: string;
}

/**
 * The rule to offer after a hand categorization: "contains" the merchant's name (rules match
 * merchant names), else the label's merchant key, the same key rule suggestions group by.
 * Null when the pattern is too short to be safe or an existing rule already does the job.
 */
export function proposeRule(input: ProposeRuleInput, existingRules: readonly CompiledRule[]): RuleProposal | null {
  const merchantName = input.merchantName?.trim() ?? "";
  const pattern = merchantName !== "" ? merchantName : merchantKey(input.labelNormalized);
  if (pattern.length < SUGGESTION_MIN_KEY_LENGTH) return null;

  const current = categorizeLabel(existingRules, {
    normalized: input.labelNormalized,
    display: input.labelDisplay ?? null,
    merchant: input.merchantName,
  });
  if (current === input.categoryId) return null;

  return { matchType: "contains", pattern, categoryId: input.categoryId };
}
