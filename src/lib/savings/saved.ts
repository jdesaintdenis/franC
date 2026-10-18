export interface SavedPair {
  /** Absolute amount of the pair, in cents (> 0). */
  amountCents: number;
  outDate: string;
  inDate: string;
  outSavings: boolean;
  inSavings: boolean;
}

/**
 * What one transfer pair adds to "Saved": +amount when money goes into a Savings account, −amount when it
 * comes out. Dated on the current-account side, the day it would otherwise have counted as spent or income.
 * Null when both legs are the same kind of account.
 */
export function savedContribution(pair: SavedPair): { date: string; cents: number } | null {
  if (pair.outSavings === pair.inSavings) return null;
  return pair.inSavings
    ? { date: pair.outDate, cents: pair.amountCents }
    : { date: pair.inDate, cents: -pair.amountCents };
}

/** "YYYY-MM" → Saved cents, counting only contributions dated inside the (inclusive) range. */
export function savedByMonth(pairs: readonly SavedPair[], range: { from: string; to: string }): Map<string, number> {
  const months = new Map<string, number>();
  for (const pair of pairs) {
    const c = savedContribution(pair);
    if (!c || c.date < range.from || c.date > range.to) continue;
    const month = c.date.slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + c.cents);
  }
  return months;
}
