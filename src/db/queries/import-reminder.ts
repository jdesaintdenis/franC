import { and, asc, eq, sql } from "drizzle-orm";

import type { AccountFreshness } from "../../lib/import-reminder/staleness";
import type { db as dbClient } from "../client";
import { accounts, users } from "../schema";

type Executor = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];

/**
 * Per account (oldest first): latest transaction date and the Paris date of its latest import.
 * Scoped by user_id.
 */
export async function getAccountFreshness(
  database: typeof dbClient | Executor,
  userId: string,
  /** Only accounts no bank link feeds: a connected account syncs by itself, so it never goes "stale" for the reminder. */
  opts: { withoutBankLink?: boolean } = {},
): Promise<AccountFreshness[]> {
  // Columns are qualified by hand: drizzle drops table prefixes in single-table selects.
  return database
    .select({
      accountId: accounts.id,
      name: accounts.name,
      reminder: accounts.importReminder,
      latestDate: sql<string | null>`(
        select max(t.date)::text from transactions t
        where t.account_id = "accounts"."id" and t.user_id = "accounts"."user_id" and t.source <> 'manual'
      )`,
      lastImportDate: sql<string | null>`(
        select (max(i.uploaded_at) at time zone 'Europe/Paris')::date::text from imports i
        where i.account_id = "accounts"."id" and i.user_id = "accounts"."user_id" and i.kind <> 'franc'
      )`,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        // A Savings account takes no imports, so it is never stale (Slice 52).
        eq(accounts.savings, false),
        opts.withoutBankLink ? sql`not ${hasBankLink}` : undefined,
      ),
    )
    .orderBy(asc(accounts.createdAt), asc(accounts.id));
}

/** True for an account some bank link (to a connection that reached the bank) feeds. */
export const hasBankLink = sql`exists (
  select 1 from bank_account_links l
  join bank_connections c on c.id = l.connection_id and c.user_id = l.user_id
  where l.account_id = "accounts"."id" and l.user_id = "accounts"."user_id" and c.status <> 'pending'
)`;

export interface ImportReminderSettings {
  /** Null = reminder off. */
  days: number | null;
  notifiedOn: string | null;
}

export async function getImportReminderSettings(
  database: typeof dbClient | Executor,
  userId: string,
): Promise<ImportReminderSettings> {
  const [row] = await database
    .select({ days: users.importReminderDays, notifiedOn: users.importReminderNotifiedOn })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? { days: null, notifiedOn: null };
}

/** Sets the reminder threshold in days; null turns the reminder off. Scoped by user_id. */
export async function setImportReminderDays(
  database: typeof dbClient | Executor,
  userId: string,
  days: number | null,
): Promise<void> {
  await database.update(users).set({ importReminderDays: days }).where(eq(users.id, userId));
}

/** Turns the reminder on or off for one account. Returns false when the account is not the user's. */
export async function setAccountImportReminder(
  database: typeof dbClient | Executor,
  userId: string,
  accountId: string,
  on: boolean,
): Promise<boolean> {
  const updated = await database
    .update(accounts)
    .set({ importReminder: on })
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .returning({ id: accounts.id });
  return updated.length > 0;
}
