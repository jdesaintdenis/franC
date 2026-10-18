import { normalizeLabel } from "../import/normalize-label";

/** What `category_rules` stores; `starts_with` is matcher-only (used by merchant patterns). */
export type RuleMatchType = "contains" | "equals" | "regex";
export type MatcherType = RuleMatchType | "starts_with";

/** The subset of a stored rule the matcher needs. Kept structural so this file stays DB-free. */
export interface RuleInput {
  id: string;
  categoryId: string;
  matchType: RuleMatchType;
  pattern: string;
  priority: number;
  createdAt: Date;
}

export interface RuleLabels {
  normalized: string | null;
  display: string | null;
  /** The merchant name the row carries, if any: rules see it as a third candidate. */
  merchant?: string | null;
}

export interface CompiledRule {
  id: string;
  categoryId: string;
  matches: (labels: RuleLabels) => boolean;
}

/** Priority asc, then createdAt asc, then id, so the order is deterministic. */
export function sortRules<T extends Pick<RuleInput, "id" | "priority" | "createdAt">>(
  rules: readonly T[],
): T[] {
  return [...rules].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

// Rules match either the stored normalized label or the normalized display
// label, since the display label may be edited independently of the raw one.
function normalizedCandidates(labels: RuleLabels): string[] {
  const candidates: string[] = [];
  if (labels.normalized) candidates.push(labels.normalized);
  if (labels.display) {
    const fromDisplay = normalizeLabel(labels.display);
    if (fromDisplay && fromDisplay !== labels.normalized) candidates.push(fromDisplay);
  }
  if (labels.merchant) {
    const fromMerchant = normalizeLabel(labels.merchant);
    if (fromMerchant && !candidates.includes(fromMerchant)) candidates.push(fromMerchant);
  }
  return candidates;
}

const NEVER = (): boolean => false;

/** Compiles one rule's pattern once. An invalid stored regex never matches and never throws. */
export function compileMatcher(rule: { matchType: MatcherType; pattern: string }): (labels: RuleLabels) => boolean {
  if (rule.matchType === "regex") {
    let regex: RegExp;
    try {
      regex = new RegExp(rule.pattern, "iu");
    } catch {
      return NEVER;
    }
    return (labels) => {
      // The raw display label is tested too so accented patterns still work.
      const targets = [...normalizedCandidates(labels)];
      if (labels.display) targets.push(labels.display);
      if (labels.merchant) targets.push(labels.merchant);
      return targets.some((t) => regex.test(t));
    };
  }

  const pattern = normalizeLabel(rule.pattern);
  // An empty pattern would match everything with "contains"; treat it as no rule.
  if (pattern === "") return NEVER;
  if (rule.matchType === "equals") {
    return (labels) => normalizedCandidates(labels).some((c) => c === pattern);
  }
  if (rule.matchType === "starts_with") {
    return (labels) => normalizedCandidates(labels).some((c) => c.startsWith(pattern));
  }
  return (labels) => normalizedCandidates(labels).some((c) => c.includes(pattern));
}

export function matchesRule(rule: { matchType: MatcherType; pattern: string }, labels: RuleLabels): boolean {
  return compileMatcher(rule)(labels);
}

/** Sorts and pre-compiles a batch of rules so matching many rows stays cheap. */
export function compileRules(rules: readonly RuleInput[]): CompiledRule[] {
  return sortRules(rules).map((rule) => ({
    id: rule.id,
    categoryId: rule.categoryId,
    matches: compileMatcher(rule),
  }));
}

/** First matching rule wins; `rules` must come from `compileRules`. */
export function categorizeLabel(rules: readonly CompiledRule[], labels: RuleLabels): string | null {
  for (const rule of rules) {
    if (rule.matches(labels)) return rule.categoryId;
  }
  return null;
}
