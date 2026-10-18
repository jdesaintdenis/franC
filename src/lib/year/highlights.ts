export interface HighlightMonth {
  month: string;
  incomeCents: number;
  spentCents: number;
  /** The month has at least one (non-transfer) transaction. */
  hasData: boolean;
}

export interface MonthHighlight {
  month: string;
  savedCents: number;
}

export interface MonthHighlights {
  best: MonthHighlight;
  worst: MonthHighlight;
}

/**
 * Best and toughest month of a year by saved (income - spent). Only finished months with data
 * count: the current month is left out because a salary that has landed before the bills would
 * always look best. Needs at least 2 such months and best != worst; ties go to the earliest month.
 */
export function bestAndWorstMonths(rows: HighlightMonth[], now: string): MonthHighlights | null {
  const candidates = rows
    .filter((r) => r.hasData && r.month < now)
    .map((r) => ({ month: r.month, savedCents: r.incomeCents - r.spentCents }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  if (candidates.length < 2) return null;
  let best = candidates[0];
  let worst = candidates[0];
  for (const c of candidates) {
    if (c.savedCents > best.savedCents) best = c;
    if (c.savedCents < worst.savedCents) worst = c;
  }
  if (best.month === worst.month) return null;
  return { best, worst };
}
