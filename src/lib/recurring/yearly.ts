import type { RecurringInterval } from "./dates";

/** Charges per year. Weekly counts 52, not 365/7, so the result stays in whole cents. */
export const CHARGES_PER_YEAR: Record<RecurringInterval, number> = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

/** Signed yearly amount of a recurring item, in integer cents (negative = outflow). */
export function yearlyCents(typicalAmountCents: number, interval: RecurringInterval): number {
  return typicalAmountCents * CHARGES_PER_YEAR[interval];
}
