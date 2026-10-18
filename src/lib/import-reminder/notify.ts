import { daysBetween } from "../recurring/dates";

/** A push goes out when data goes stale, then at most once per this many days while it stays stale. */
export const NOTIFY_EVERY_DAYS = 7;

/** Whether the daily job should send this user an import-reminder push today. */
export function shouldNotify(input: {
  reminderOn: boolean;
  subscriptionCount: number;
  staleCount: number;
  /** Paris date of the last push, or null. */
  lastNotifiedOn: string | null;
  today: string;
}): boolean {
  const { reminderOn, subscriptionCount, staleCount, lastNotifiedOn, today } = input;
  if (!reminderOn || subscriptionCount === 0 || staleCount === 0) return false;
  return lastNotifiedOn === null || daysBetween(lastNotifiedOn, today) >= NOTIFY_EVERY_DAYS;
}
