import { addMonthsClamped } from "../recurring/dates";

/**
 * The date of the loan's next payment: the regular payment's expected date when it is still ahead, else one month
 * after the last payment seen, else the loan's start. Dates are "YYYY-MM-DD".
 */
export function nextDueDate(input: {
  recurringNext: string | null;
  lastPaymentDate: string | null;
  startDate: string;
  today: string;
}): string {
  if (input.recurringNext !== null && input.recurringNext >= input.today) return input.recurringNext;
  if (input.lastPaymentDate !== null) return addMonthsClamped(input.lastPaymentDate, 1);
  return input.startDate;
}
