import { and, eq, isNotNull, sql } from "drizzle-orm";

import type { db as dbClient } from "../client";
import { pushSubscriptions, users } from "../schema";

type Executor = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];
type Database = typeof dbClient | Executor;

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Saves a device's subscription. The endpoint is unique per browser install, so when it already
 * exists (another user signed in on the same device) it is reassigned to the current user.
 */
export async function savePushSubscription(
  database: Database,
  userId: string,
  subscription: PushSubscriptionInput,
): Promise<void> {
  await database
    .insert(pushSubscriptions)
    .values({ userId, ...subscription })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: subscription.p256dh, auth: subscription.auth },
    });
}

/** Removes one of the user's subscriptions. Returns whether a row was deleted. */
export async function deletePushSubscription(database: Database, userId: string, endpoint: string): Promise<boolean> {
  const deleted = await database
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .returning({ id: pushSubscriptions.id });
  return deleted.length > 0;
}

/** System job only: drops a subscription the push service reported as expired (404/410). */
export async function deleteExpiredPushSubscription(database: Database, endpoint: string): Promise<void> {
  await database.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function listPushSubscriptions(database: Database, userId: string): Promise<PushSubscriptionInput[]> {
  return database
    .select({ endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(pushSubscriptions.createdAt, pushSubscriptions.id);
}

export interface PushCandidate {
  userId: string;
  locale: string | null;
  days: number;
  notifiedOn: string | null;
}

/** Users the daily job should look at: reminder on and at least one subscribed device. */
export async function listPushCandidates(database: Database): Promise<PushCandidate[]> {
  const rows = await database
    .select({
      userId: users.id,
      locale: users.locale,
      days: users.importReminderDays,
      notifiedOn: users.importReminderNotifiedOn,
    })
    .from(users)
    .where(
      and(
        isNotNull(users.importReminderDays),
        sql`exists (select 1 from push_subscriptions p where p.user_id = ${users.id})`,
      ),
    );
  return rows.flatMap((r) => (r.days === null ? [] : [{ ...r, days: r.days }]));
}

/** Records the Paris date of the last push so the next one waits NOTIFY_EVERY_DAYS. Scoped by user_id. */
export async function markImportReminderNotified(database: Database, userId: string, date: string): Promise<void> {
  await database.update(users).set({ importReminderNotifiedOn: date }).where(eq(users.id, userId));
}

export interface BankHealthCandidate {
  userId: string;
  email: string;
  locale: string | null;
  notifiedOn: string | null;
}

/** Users with at least one subscribed device, for the bank health push. The caller filters by email. */
export async function listBankHealthCandidates(database: Database): Promise<BankHealthCandidate[]> {
  return database
    .select({ userId: users.id, email: users.email, locale: users.locale, notifiedOn: users.bankHealthNotifiedOn })
    .from(users)
    .where(sql`exists (select 1 from push_subscriptions p where p.user_id = ${users.id})`);
}

/** Records the Paris date of the last bank health push so the next one waits a week. Scoped by user_id. */
export async function markBankHealthNotified(database: Database, userId: string, date: string): Promise<void> {
  await database.update(users).set({ bankHealthNotifiedOn: date }).where(eq(users.id, userId));
}
