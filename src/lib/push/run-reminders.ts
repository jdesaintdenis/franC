import type { db as dbClient } from "@/db/client";
import { getAccountFreshness } from "@/db/queries/import-reminder";
import {
  deleteExpiredPushSubscription,
  listBankHealthCandidates,
  listPushCandidates,
  listPushSubscriptions,
  markBankHealthNotified,
  markImportReminderNotified,
  type PushSubscriptionInput,
} from "@/db/queries/push";
import { findStaleAccounts } from "@/lib/import-reminder/staleness";
import { NOTIFY_EVERY_DAYS, shouldNotify } from "@/lib/import-reminder/notify";
import { daysBetween } from "@/lib/recurring/dates";
import { listBankConnections } from "@/db/queries/bank-connections";

import { buildBankHealthPayload, buildReminderPayload, type ReminderPayload } from "./payload";

/** Sends one push. Resolves with the push service's HTTP status when it rejects (e.g. 410), else ok. */
export type SendPush = (
  subscription: PushSubscriptionInput,
  payload: ReminderPayload,
) => Promise<{ ok: true } | { ok: false; statusCode: number | null }>;

export interface ReminderRunCounts {
  users: number;
  sent: number;
  failed: number;
  removed: number;
}

/**
 * The daily job: pushes the import reminder to users whose data went stale. Returns counts only,
 * so callers can log without touching user data.
 */
export async function runImportReminders(input: {
  database: typeof dbClient;
  send: SendPush;
  /** "YYYY-MM-DD" in Europe/Paris. */
  today: string;
}): Promise<ReminderRunCounts> {
  const { database, send, today } = input;
  const counts: ReminderRunCounts = { users: 0, sent: 0, failed: 0, removed: 0 };

  for (const candidate of await listPushCandidates(database)) {
    const subscriptions = await listPushSubscriptions(database, candidate.userId);
    const stale = findStaleAccounts({
      accounts: await getAccountFreshness(database, candidate.userId, { withoutBankLink: true }),
      days: candidate.days,
      today,
    });
    const due = shouldNotify({
      reminderOn: true,
      subscriptionCount: subscriptions.length,
      staleCount: stale.length,
      lastNotifiedOn: candidate.notifiedOn,
      today,
    });
    if (!due) continue;

    counts.users += 1;
    const payload = await buildReminderPayload({ locale: candidate.locale, ageDays: stale[0].ageDays });
    if (await deliver(database, send, subscriptions, payload, counts)) {
      await markImportReminderNotified(database, candidate.userId, today);
    }
  }
  return counts;
}

/** Sends to every device, dropping expired subscriptions. True when at least one device got it. */
async function deliver(
  database: typeof dbClient,
  send: SendPush,
  subscriptions: PushSubscriptionInput[],
  payload: ReminderPayload,
  counts: ReminderRunCounts,
): Promise<boolean> {
  let delivered = false;
  for (const subscription of subscriptions) {
    const result = await send(subscription, payload);
    if (result.ok) {
      counts.sent += 1;
      delivered = true;
    } else if (result.statusCode === 404 || result.statusCode === 410) {
      counts.removed += 1;
      await deleteExpiredPushSubscription(database, subscription.endpoint);
    } else {
      counts.failed += 1;
    }
  }
  return delivered;
}

/**
 * The daily job's bank health push: for allowed users with a subscribed device, when a connection
 * needs a reconnect, or has been failing since before this run (the second failed morning in a row;
 * Home shows the first). At most one push a week. Counts only.
 */
export async function runBankHealthPush(input: {
  database: typeof dbClient;
  send: SendPush;
  isAllowed: (email: string) => boolean;
  /** "YYYY-MM-DD" in Europe/Paris. */
  today: string;
  /** When this run began: a failure that started during it is the first, not the second. */
  runStartedAt: Date;
}): Promise<ReminderRunCounts> {
  const { database, send, today, runStartedAt } = input;
  const counts: ReminderRunCounts = { users: 0, sent: 0, failed: 0, removed: 0 };

  for (const candidate of await listBankHealthCandidates(database)) {
    if (!input.isAllowed(candidate.email)) continue;
    if (candidate.notifiedOn !== null && daysBetween(candidate.notifiedOn, today) < NOTIFY_EVERY_DAYS) continue;

    const healths = (await listBankConnections(database, candidate.userId, runStartedAt)).map((c) => c.health);
    const failingSince = healths.flatMap((h) => (h.kind === "failing" && h.since < runStartedAt ? [h.since] : []));
    const kind = healths.some((h) => h.kind === "reconnect") ? "reconnect" : failingSince.length > 0 ? "failing" : null;
    if (!kind) continue;

    const subscriptions = await listPushSubscriptions(database, candidate.userId);
    if (subscriptions.length === 0) continue;
    counts.users += 1;
    const payload = await buildBankHealthPayload({
      locale: candidate.locale,
      kind,
      since: new Date(Math.min(...failingSince.map((d) => d.getTime()))),
      today,
    });
    if (await deliver(database, send, subscriptions, payload, counts)) {
      await markBankHealthNotified(database, candidate.userId, today);
    }
  }
  return counts;
}
