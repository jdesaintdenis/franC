/** Before this day of the month there is too little spending to extrapolate from. */
export const PACE_FROM_DAY = 5;

export interface PaceContext {
  /** Day of the month today (1-based), in the current month. */
  day: number;
  daysInMonth: number;
  /** Positive: recurring bills still due this month, by the budget category covering them. */
  billsDueCents?: ReadonlyMap<string, number>;
}

export interface PaceInput {
  spentCents: number;
  /** Part of spentCents that was recurring charges (not extrapolated: rent comes once). */
  recurringSpentCents: number;
  billsDueCents: number;
  availableCents: number;
}

/**
 * True when a budget that isn't over yet is on track to be by month end:
 *   recurring already paid + bills still due + other spending × daysInMonth / day > available.
 * Compared as a cross-product in BigInt, with no division, so it stays exact.
 */
export function onPaceToOverspend(input: PaceInput, context: PaceContext): boolean {
  const { day, daysInMonth } = context;
  if (day < PACE_FROM_DAY || input.spentCents > input.availableCents) return false;
  const recurring = Math.min(input.recurringSpentCents, input.spentCents);
  const other = BigInt(input.spentCents - recurring);
  const fixed = BigInt(recurring + input.billsDueCents);
  const projectedTimesDay = fixed * BigInt(day) + other * BigInt(daysInMonth);
  return projectedTimesDay > BigInt(input.availableCents) * BigInt(day);
}
