import { daysBetween } from "../recurring/dates";

export const DEFAULT_REMINDER_DAYS = 14;
export const MIN_REMINDER_DAYS = 1;
export const MAX_REMINDER_DAYS = 365;

export interface AccountFreshness {
  accountId: string;
  name: string;
  /** Latest transaction date ("YYYY-MM-DD"), or null when the account has none. */
  latestDate: string | null;
  /** Paris date of the latest import into the account, or null when never imported. */
  lastImportDate: string | null;
  /** Whether the import reminder watches this account. */
  reminder: boolean;
}

export interface StaleAccount {
  accountId: string;
  name: string;
  latestDate: string | null;
  /** The later of the latest transaction and the latest import. */
  freshDate: string;
  /** Whole days from `freshDate` to today. */
  ageDays: number;
}

/**
 * The later of an account's latest transaction and its latest import: importing a file with
 * nothing new in it (a quiet savings account) still means the data is up to date.
 */
export function freshDate(account: Pick<AccountFreshness, "latestDate" | "lastImportDate">): string | null {
  const { latestDate, lastImportDate } = account;
  if (latestDate === null) return lastImportDate;
  if (lastImportDate === null) return latestDate;
  // ISO strings compare correctly.
  return latestDate > lastImportDate ? latestDate : lastImportDate;
}

/**
 * Accounts with no new data for more than `days` days, oldest first. `days` null means the
 * reminder is off. Accounts never imported are skipped: the empty states already point to Import.
 */
export function findStaleAccounts(input: {
  accounts: AccountFreshness[];
  days: number | null;
  /** "YYYY-MM-DD" in Europe/Paris. */
  today: string;
}): StaleAccount[] {
  const { accounts, days, today } = input;
  if (days === null) return [];
  const stale: StaleAccount[] = [];
  for (const account of accounts) {
    if (!account.reminder) continue;
    const fresh = freshDate(account);
    if (fresh === null) continue;
    const ageDays = daysBetween(fresh, today);
    if (ageDays > days) {
      stale.push({ accountId: account.accountId, name: account.name, latestDate: account.latestDate, freshDate: fresh, ageDays });
    }
  }
  return stale.sort((a, b) => b.ageDays - a.ageDays || a.name.localeCompare(b.name));
}

/** Latest transaction date across accounts, or null when there is none. */
export function dataUpTo(accounts: Pick<AccountFreshness, "latestDate">[]): string | null {
  let latest: string | null = null;
  for (const { latestDate } of accounts) {
    if (latestDate !== null && (latest === null || latestDate > latest)) latest = latestDate;
  }
  return latest;
}

/** Accounts whose latest transaction is older than the newest one, oldest first (for "Savings: 2 Aug"). */
export function laggingAccounts<T extends Pick<AccountFreshness, "latestDate" | "name">>(accounts: T[]): T[] {
  const newest = dataUpTo(accounts);
  if (newest === null) return [];
  return accounts
    .filter((a) => a.latestDate !== null && a.latestDate < newest)
    .sort((a, b) => (a.latestDate ?? "").localeCompare(b.latestDate ?? ""));
}
