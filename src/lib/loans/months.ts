import { addMonthsClamped } from "../recurring/dates";

const MAX_SLOTS = 1200;

/**
 * The loan's monthly payment dates after `after` (exclusive) up to `lastPaymentOn` (inclusive), oldest first.
 * They fall on the contract's payment day (the day of `lastPaymentOn`, clamped to short months).
 */
export function paymentSlots(lastPaymentOn: string, after: string): string[] {
  const slots: string[] = [];
  for (let k = 0; k < MAX_SLOTS; k += 1) {
    const date = addMonthsClamped(lastPaymentOn, -k);
    if (date <= after) break;
    slots.push(date);
  }
  return slots.reverse();
}

export interface LoanLength {
  monthsTotal: number;
  monthsPaid: number;
  monthsLeft: number;
}

/** Contract length from `after` (the subscription date, or the first checkpoint) to the last payment. */
export function loanLength(input: { lastPaymentOn: string; after: string; today: string }): LoanLength {
  const slots = paymentSlots(input.lastPaymentOn, input.after);
  const monthsPaid = slots.filter((d) => d <= input.today).length;
  return { monthsTotal: slots.length, monthsPaid, monthsLeft: slots.length - monthsPaid };
}
