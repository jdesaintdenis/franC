import { normalizeLabel } from "../import/normalize-label";
import { compileMatcher } from "../categorize/rules";

export type MerchantMatchType = "contains" | "starts_with" | "equals";

/** The subset of a stored pattern the matcher needs. Structural so this file stays DB-free. */
export interface MerchantPatternInput {
  merchantId: string;
  matchType: MerchantMatchType;
  pattern: string;
  createdAt: Date;
}

export interface MerchantLabels {
  normalized: string | null;
  display: string | null;
}

export interface CompiledMerchantPattern {
  merchantId: string;
  matches: (labels: MerchantLabels) => boolean;
}

// Higher rank = more specific.
const TYPE_RANK: Record<MerchantMatchType, number> = { equals: 2, starts_with: 1, contains: 0 };

/** Most specific first: type, then longer normalized pattern, then oldest, then merchant id. */
function compareSpecificity(
  a: { rank: number; length: number; createdAt: Date; merchantId: string },
  b: { rank: number; length: number; createdAt: Date; merchantId: string },
): number {
  return (
    b.rank - a.rank ||
    b.length - a.length ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.merchantId < b.merchantId ? -1 : a.merchantId > b.merchantId ? 1 : 0)
  );
}

/**
 * Sorts patterns by specificity and compiles them once, so `resolveMerchant` is a
 * first-match scan. An empty (after normalization) pattern is dropped: it would match everything.
 */
export function compileMerchantPatterns(patterns: readonly MerchantPatternInput[]): CompiledMerchantPattern[] {
  return patterns
    .map((p) => ({ p, length: normalizeLabel(p.pattern).length }))
    .filter(({ length }) => length > 0)
    .sort((a, b) =>
      compareSpecificity(
        { rank: TYPE_RANK[a.p.matchType], length: a.length, createdAt: a.p.createdAt, merchantId: a.p.merchantId },
        { rank: TYPE_RANK[b.p.matchType], length: b.length, createdAt: b.p.createdAt, merchantId: b.p.merchantId },
      ),
    )
    .map(({ p }) => ({ merchantId: p.merchantId, matches: compileMatcher(p) }));
}

/** Merchant id of the most specific matching pattern, or null. `compiled` must come from `compileMerchantPatterns`. */
export function resolveMerchant(
  compiled: readonly CompiledMerchantPattern[],
  labels: MerchantLabels,
): string | null {
  for (const pattern of compiled) {
    if (pattern.matches(labels)) return pattern.merchantId;
  }
  return null;
}

/** True when a single pattern matches; used for the live "renames N transactions" count. */
export function matchesMerchantPattern(
  pattern: { matchType: MerchantMatchType; pattern: string },
  labels: MerchantLabels,
): boolean {
  return compileMatcher(pattern)(labels);
}
