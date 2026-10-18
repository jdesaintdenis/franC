import { merchantKey } from "../recurring/merchant-key";

/** Below this confidence no category is guessed. */
export const GUESS_THRESHOLD = 0.6;
/** Recency half-life: a choice this old counts half as much as one made on the target's date. */
export const GUESS_HALF_LIFE_DAYS = 180;
/** Minimum IDF-weighted Jaccard similarity for the "similar label" tier. */
export const SIMILARITY_MIN = 0.6;
const KEY_TIER_WEIGHT = 0.95;
const SINGLE_EXAMPLE_SUPPORT = 0.8;

/** A row the user (or a rule) categorized: what guessing learns from. */
export interface GuessExample {
  categoryId: string;
  merchantId: string | null;
  labelNormalized: string;
  amountCents: number;
  /** ISO date `YYYY-MM-DD`. */
  date: string;
}

/** A row to guess a category for. */
export interface GuessTarget {
  merchantId: string | null;
  labelNormalized: string;
  amountCents: number;
  /** ISO date `YYYY-MM-DD`. */
  date: string;
}

export interface Guess {
  categoryId: string;
  confidence: number;
}

interface PreparedExample extends GuessExample {
  key: string;
  tokens: Set<string>;
  positive: boolean;
  dayNumber: number;
}

/** Days since the epoch of an ISO date, computed in UTC so no time zone shifts the day. */
function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Letters-and-digits tokens of a merchant key; pure numbers and single characters carry no signal. */
export function tokenize(key: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of key.split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < 2 || /^\p{N}+$/u.test(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

function recencyWeight(targetDay: number, exampleDay: number): number {
  return 0.5 ** (Math.abs(targetDay - exampleDay) / GUESS_HALF_LIFE_DAYS);
}

function vote(neighbours: readonly PreparedExample[], targetDay: number, tierWeight: number): Guess | null {
  const votes = new Map<string, number>();
  let total = 0;
  for (const n of neighbours) {
    const w = recencyWeight(targetDay, n.dayNumber);
    votes.set(n.categoryId, (votes.get(n.categoryId) ?? 0) + w);
    total += w;
  }
  let best: string | null = null;
  let bestVotes = -1;
  for (const [categoryId, v] of votes) {
    // Ties break on the category id so the result never depends on input order.
    if (v > bestVotes || (v === bestVotes && best !== null && categoryId < best)) {
      best = categoryId;
      bestVotes = v;
    }
  }
  if (best === null || total <= 0) return null;
  const support = neighbours.length >= 2 ? 1 : SINGLE_EXAMPLE_SUPPORT;
  const confidence = (bestVotes / total) * support * tierWeight;
  return confidence >= GUESS_THRESHOLD ? { categoryId: best, confidence } : null;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Builds the lookup tables once (merchant, key, token index, IDF) and returns a guesser.
 * Tiers, first one with neighbours wins: same merchant (weight 1), same merchant key (0.95),
 * similar label (weight = best similarity). Neighbours must have the same amount sign.
 */
export function buildGuesser(examples: readonly GuessExample[]): (row: GuessTarget) => Guess | null {
  const prepared: PreparedExample[] = examples.map((e) => {
    const key = merchantKey(e.labelNormalized);
    return { ...e, key, tokens: tokenize(key), positive: e.amountCents >= 0, dayNumber: dayNumber(e.date) };
  });

  const byMerchant = new Map<string, PreparedExample[]>();
  const byKey = new Map<string, PreparedExample[]>();
  const byToken = new Map<string, PreparedExample[]>();
  for (const e of prepared) {
    if (e.merchantId !== null) pushTo(byMerchant, e.merchantId, e);
    pushTo(byKey, e.key, e);
    for (const t of e.tokens) pushTo(byToken, t, e);
  }
  // Rare tokens (a shop name) weigh more than common ones ("PARIS", "CARTE").
  const idf = (token: string): number => Math.log((prepared.length + 1) / ((byToken.get(token)?.length ?? 0) + 1)) + 1;
  const weightOf = (tokens: Iterable<string>): number => {
    let sum = 0;
    for (const t of tokens) sum += idf(t);
    return sum;
  };

  return (row) => {
    const positive = row.amountCents >= 0;
    const day = dayNumber(row.date);

    if (row.merchantId !== null) {
      const same = (byMerchant.get(row.merchantId) ?? []).filter((e) => e.positive === positive);
      if (same.length > 0) return vote(same, day, 1);
    }

    const key = merchantKey(row.labelNormalized);
    const sameKey = (byKey.get(key) ?? []).filter((e) => e.positive === positive);
    if (sameKey.length > 0) return vote(sameKey, day, KEY_TIER_WEIGHT);

    const tokens = tokenize(key);
    if (tokens.size === 0) return null;
    const candidates = new Set<PreparedExample>();
    for (const t of tokens) for (const e of byToken.get(t) ?? []) if (e.positive === positive) candidates.add(e);
    const targetWeight = weightOf(tokens);
    const similar: PreparedExample[] = [];
    let best = 0;
    for (const e of candidates) {
      let shared = 0;
      for (const t of tokens) if (e.tokens.has(t)) shared += idf(t);
      const union = targetWeight + weightOf(e.tokens) - shared;
      const similarity = union > 0 ? shared / union : 0;
      if (similarity < SIMILARITY_MIN) continue;
      similar.push(e);
      best = Math.max(best, similarity);
    }
    return similar.length > 0 ? vote(similar, day, best) : null;
  };
}
