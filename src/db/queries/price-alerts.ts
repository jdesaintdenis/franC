import { and, desc, eq, sql } from "drizzle-orm";

import type { db as dbClient } from "../client";
import { merchantIdOfKey } from "../../lib/recurring/detect";
import { loadMerchantNames } from "./merchants";
import { accounts, recurring, recurringPriceAlerts, type RecurringPriceAlert } from "../schema";

export interface OpenPriceAlert {
  id: string;
  recurringId: string;
  /** Merchant name, else the display label of the item's latest linked transaction, or its merchant key. */
  name: string;
  accountId: string;
  /** Name of the item's account (the user's own data, not translated). */
  accountName: string;
  /** Usual amount (signed cents). */
  oldAmountCents: number;
  /** Amount of the higher charge (signed cents). */
  newAmountCents: number;
  chargedOn: string;
}

/** The user's open price alerts, newest charge first. */
export async function listOpenPriceAlerts(
  database: typeof dbClient,
  userId: string,
  options: { accountId?: string } = {},
): Promise<OpenPriceAlert[]> {
  // Same correlated lookup as listRecurring; columns are written out qualified.
  const latestLabel = sql<string | null>`(
    select t.label_display from transactions t
    where t.recurring_id = "recurring"."id" and t.user_id = "recurring"."user_id"
    order by t.date desc, t.id desc
    limit 1
  )`;

  const rows = await database
    .select({
      id: recurringPriceAlerts.id,
      recurringId: recurringPriceAlerts.recurringId,
      merchantKey: recurring.merchantKey,
      accountId: recurring.accountId,
      accountName: accounts.name,
      oldAmountCents: recurringPriceAlerts.oldAmountCents,
      newAmountCents: recurringPriceAlerts.newAmountCents,
      chargedOn: recurringPriceAlerts.chargedOn,
      latestLabel,
    })
    .from(recurringPriceAlerts)
    .innerJoin(
      recurring,
      and(eq(recurring.id, recurringPriceAlerts.recurringId), eq(recurring.userId, userId)),
    )
    .innerJoin(accounts, and(eq(accounts.id, recurring.accountId), eq(accounts.userId, userId)))
    .where(
      and(
        eq(recurringPriceAlerts.userId, userId),
        eq(recurringPriceAlerts.status, "open"),
        options.accountId ? eq(recurring.accountId, options.accountId) : undefined,
      ),
    )
    .orderBy(desc(recurringPriceAlerts.chargedOn), desc(recurringPriceAlerts.id));

  const merchantNames = rows.some((r) => merchantIdOfKey(r.merchantKey) !== null)
    ? await loadMerchantNames(database, userId)
    : new Map<string, string>();
  return rows.map(({ latestLabel: label, merchantKey, ...row }) => {
    const keyedId = merchantIdOfKey(merchantKey);
    const merchantName = keyedId === null ? undefined : merchantNames.get(keyedId);
    return { ...row, name: merchantName ?? (label && label.trim() !== "" ? label : merchantKey) };
  });
}

/**
 * Accepts the new price: the item's usual amount becomes the charge's amount and the
 * item becomes confirmed (the user vouches for it, so it isn't dropped before three
 * charges at the new price qualify). Returns `null` when the alert doesn't exist, isn't
 * the user's, or isn't open.
 */
export async function acceptPriceAlert(
  database: typeof dbClient,
  userId: string,
  id: string,
): Promise<RecurringPriceAlert | null> {
  return database.transaction(async (tx) => {
    const [alert] = await tx
      .update(recurringPriceAlerts)
      .set({ status: "accepted", resolvedAt: new Date() })
      .where(
        and(
          eq(recurringPriceAlerts.id, id),
          eq(recurringPriceAlerts.userId, userId),
          eq(recurringPriceAlerts.status, "open"),
        ),
      )
      .returning();
    if (!alert) return null;

    await tx
      .update(recurring)
      .set({ typicalAmountCents: alert.newAmountCents, status: "confirmed" })
      .where(and(eq(recurring.id, alert.recurringId), eq(recurring.userId, userId)));
    return alert;
  });
}

/** Dismisses the alert for that charge only; the usual amount stays. Same `null` rule as accept. */
export async function dismissPriceAlert(
  database: typeof dbClient,
  userId: string,
  id: string,
): Promise<RecurringPriceAlert | null> {
  const [alert] = await database
    .update(recurringPriceAlerts)
    .set({ status: "dismissed", resolvedAt: new Date() })
    .where(
      and(
        eq(recurringPriceAlerts.id, id),
        eq(recurringPriceAlerts.userId, userId),
        eq(recurringPriceAlerts.status, "open"),
      ),
    )
    .returning();
  return alert ?? null;
}
