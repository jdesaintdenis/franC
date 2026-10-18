import { daysBetween } from "../recurring/dates";

export const NOT_FOUND_AFTER_DAYS = 7;

/** True when a row added by hand and still waiting for the bank is more than 7 days old (ISO dates, Paris). */
export function isNotFound(date: string, today: string): boolean {
  return daysBetween(date, today) > NOT_FOUND_AFTER_DAYS;
}
