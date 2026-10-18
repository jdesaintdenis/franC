import { and, asc, eq, inArray, isNotNull, ne, notInArray, or, sql } from "drizzle-orm";

import type { db as dbClient } from "../client";
import { nextExpectedDate } from "../../lib/recurring/dates";
import {
  detectRecurring,
  groupKey,
  groupTransactions,
  merchantIdOfKey,
  txMerchantKey,
  type RecurringTx,
  type Sign,
} from "../../lib/recurring/detect";
import { rekeyItems } from "../../lib/recurring/rekey";
import { loadMerchantNames } from "./merchants";
import { isPossiblyCancelled } from "../../lib/recurring/missed";
import { checkPriceAlert } from "../../lib/recurring/price-alerts";
import { trackedFields } from "../../lib/recurring/tracked";
import { yearlyCents } from "../../lib/recurring/yearly";
import { notIgnored, notInTransfer, savingsSideLeg } from "./transfer-sql";
import { accounts, recurring, recurringPriceAlerts, transactions, type Recurring } from "../schema";

const CHUNK_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export interface RefreshResult {
  detected: number;
  updated: number;
  removed: number;
  /** Price alerts newly raised by this run. */
  priceAlerts: number;
}

/** Items are per (account, merchant): the same merchant on two accounts is two items. */
function itemKey(accountId: string, merchantKey: string): string {
  return `${accountId}:${merchantKey}`;
}

/**
 * Re-runs detection over all of the user's transactions, per account, and syncs the
 * `recurring` table and `transactions.recurring_id` links, in one DB
 * transaction.
 *
 * - the staleness reference date is the latest transaction date across all
 *   accounts, so a closed account's items go stale instead of being forecast forever
 * - new candidates are inserted as `detected`
 * - existing detected/confirmed items are refreshed, keeping their status
 * - dismissed items are final: never updated, never re-linked
 * - ended items (cancelled by the user) keep their links but not their dates; a charge
 *   newer than their last one brings them back as confirmed, so a subscription that
 *   restarted is forecast again
 * - before an item's usual amount is overwritten, its latest charge is checked against
 *   it and a price alert is raised, moved or cleared (see `checkPriceAlert`); an item
 *   with an open alert keeps its usual amount and is not deleted, so the old price
 *   stays visible until the user accepts or dismisses the alert
 * - tracked (`manual`) items are never matched to candidates nor alerted; their amount (median
 *   of the last 6), cadence and dates come from `trackedFields`; deleted only when no payment is left
 * - `detected` items that no longer qualify are deleted
 * - `confirmed` items that no longer qualify are kept; only their dates are
 *   refreshed from the merchant's remaining transactions
 * - `detected` and `confirmed` items whose merchant has no transactions left
 *   (e.g. after undoing the import that held them) are deleted, so they stop
 *   feeding the forecast
 */
export async function refreshRecurring(
  database: typeof dbClient,
  userId: string,
): Promise<RefreshResult> {
  return database.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        date: transactions.date,
        amountCents: transactions.amountCents,
        labelNormalized: transactions.labelNormalized,
        merchantId: transactions.merchantId,
        recurringId: transactions.recurringId,
      })
      .from(transactions)
      // Ignored rows never feed detection. Internal transfers (paired rows) are not recurring payments; transfers to
      // accounts outside franC are never paired, so they stay. The current-account leg of a transfer to a Savings
      // account stays too (a standing order to savings is a regular payment).
      .where(and(eq(transactions.userId, userId), notIgnored(), or(notInTransfer(userId), savingsSideLeg(userId))));

    if (rows.length === 0) {
      const removed = await tx
        .delete(recurring)
        .where(and(eq(recurring.userId, userId), ne(recurring.status, "dismissed")))
        .returning({ id: recurring.id });
      return { detected: 0, updated: 0, removed: removed.length, priceAlerts: 0 };
    }

    // ISO dates compare correctly as strings; avoids Date objects.
    const referenceDate = rows.reduce((max, t) => (t.date > max ? t.date : max), rows[0].date);
    const txsByAccount = new Map<string, RecurringTx[]>();
    for (const row of rows) {
      const list = txsByAccount.get(row.accountId);
      if (list) list.push(row);
      else txsByAccount.set(row.accountId, [row]);
    }
    const candidates = [...txsByAccount].flatMap(([accountId, accountTxs]) =>
      detectRecurring(accountTxs, referenceDate).map((c) => ({ ...c, accountId })),
    );
    const groupsByAccount = new Map(
      [...txsByAccount].map(([accountId, accountTxs]) => [accountId, groupTransactions(accountTxs)]),
    );
    let existing = await tx.select().from(recurring).where(eq(recurring.userId, userId));

    // Items follow their transactions when names were added, removed or merged: done before
    // candidates are matched, so a confirmed item keeps its status and price alerts.
    const linkedTxIds = new Map<string, string[]>();
    const currentKeyOfTx = new Map<string, string>();
    for (const row of rows) {
      const key = txMerchantKey(row);
      if (key === null || row.amountCents === 0) continue;
      currentKeyOfTx.set(row.id, key);
      if (row.recurringId === null) continue;
      const list = linkedTxIds.get(row.recurringId);
      if (list) list.push(row.id);
      else linkedTxIds.set(row.recurringId, [row.id]);
    }
    const moves = rekeyItems({
      items: existing.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        merchantKey: r.merchantKey,
        sign: (r.typicalAmountCents < 0 ? "out" : "in") as Sign,
        status: r.status,
        lastSeenDate: r.lastSeenDate,
      })),
      linkedTxIds,
      currentKeyOfTx,
      hasGroup: (accountId, key, sign) => groupsByAccount.get(accountId)?.has(groupKey(key, sign)) === true,
    });
    if (moves.deletes.length > 0 || moves.rekeys.length > 0) {
      // Losers go first so a survivor can take their key (unique per account and key).
      if (moves.deletes.length > 0) {
        await tx.delete(recurring).where(and(eq(recurring.userId, userId), inArray(recurring.id, moves.deletes)));
      }
      for (const move of moves.rekeys) {
        await tx
          .update(recurring)
          .set({ merchantKey: move.merchantKey })
          .where(and(eq(recurring.id, move.id), eq(recurring.userId, userId)));
      }
      const gone = new Set(moves.deletes);
      const newKey = new Map(moves.rekeys.map((m) => [m.id, m.merchantKey]));
      existing = existing
        .filter((r) => !gone.has(r.id))
        .map((r) => (newKey.has(r.id) ? { ...r, merchantKey: newKey.get(r.id) ?? r.merchantKey } : r));
    }
    // Revived before price alerts and candidates, so the rest treats them as confirmed.
    const revived = new Set<string>();
    for (const row of existing) {
      if (row.status !== "ended") continue;
      const sign: Sign = row.typicalAmountCents < 0 ? "out" : "in";
      const group = groupsByAccount.get(row.accountId)?.get(groupKey(row.merchantKey, sign));
      if (group && group.lastSeenDate > row.lastSeenDate) revived.add(row.id);
    }
    if (revived.size > 0) {
      await tx
        .update(recurring)
        .set({ status: "confirmed", endedAt: null, stillActiveAt: null })
        .where(and(eq(recurring.userId, userId), inArray(recurring.id, [...revived])));
      existing = existing.map((r) =>
        revived.has(r.id) ? { ...r, status: "confirmed" as const, endedAt: null, stillActiveAt: null } : r,
      );
    }
    const existingByKey = new Map(existing.map((r) => [itemKey(r.accountId, r.merchantKey), r]));

    const alertRows = await tx
      .select()
      .from(recurringPriceAlerts)
      .where(eq(recurringPriceAlerts.userId, userId));
    const openAlertByItem = new Map(alertRows.filter((a) => a.status === "open").map((a) => [a.recurringId, a]));
    const resolvedByItem = new Map<string, Set<string>>();
    for (const a of alertRows) {
      if (a.status === "open") continue;
      const set = resolvedByItem.get(a.recurringId);
      if (set) set.add(a.transactionId);
      else resolvedByItem.set(a.recurringId, new Set([a.transactionId]));
    }

    // Checked against the stored usual amount, before the candidate loop overwrites it.
    let priceAlerts = 0;
    const withOpenAlert = new Set(openAlertByItem.keys());
    for (const row of existing) {
      // Tracked items vary by design: no price alerts.
      if (row.status === "dismissed" || row.status === "ended" || row.source === "manual") continue;
      const sign: Sign = row.typicalAmountCents < 0 ? "out" : "in";
      const group = groupsByAccount.get(row.accountId)?.get(groupKey(row.merchantKey, sign));
      if (!group) continue;
      const open = openAlertByItem.get(row.id) ?? null;
      const check = checkPriceAlert(row, group.txs, open, resolvedByItem.get(row.id));
      if (check.action === "raise") {
        await tx.insert(recurringPriceAlerts).values({
          userId,
          recurringId: row.id,
          transactionId: check.transactionId,
          oldAmountCents: check.oldAmountCents,
          newAmountCents: check.newAmountCents,
          chargedOn: check.chargedOn,
        });
        withOpenAlert.add(row.id);
        priceAlerts++;
      } else if (check.action === "update" && open) {
        await tx
          .update(recurringPriceAlerts)
          .set({
            transactionId: check.transactionId,
            newAmountCents: check.newAmountCents,
            chargedOn: check.chargedOn,
          })
          .where(and(eq(recurringPriceAlerts.id, open.id), eq(recurringPriceAlerts.userId, userId)));
      } else if (check.action === "clear" && open) {
        await tx
          .delete(recurringPriceAlerts)
          .where(and(eq(recurringPriceAlerts.id, open.id), eq(recurringPriceAlerts.userId, userId)));
        withOpenAlert.delete(row.id);
      }
    }

    // recurring id -> transaction ids to link
    const links = new Map<string, string[]>();
    let detected = 0;
    let updated = 0;
    let removed = 0;

    const toInsert = [];
    const candidateKeys = new Set<string>();
    for (const c of candidates) {
      const row = existingByKey.get(itemKey(c.accountId, c.merchantKey));
      // Ended items are settled in the loop below, which keeps their links.
      // Tracked items are settled below: detection never reshapes them.
      if (row?.status === "dismissed" || row?.status === "ended" || row?.source === "manual") continue;
      candidateKeys.add(itemKey(c.accountId, c.merchantKey));
      if (row) {
        await tx
          .update(recurring)
          .set({
            // An open price alert freezes the usual amount until the user decides.
            ...(withOpenAlert.has(row.id) ? {} : { typicalAmountCents: c.typicalAmountCents }),
            interval: c.interval,
            lastSeenDate: c.lastSeenDate,
            nextExpectedDate: c.nextExpectedDate,
          })
          .where(and(eq(recurring.id, row.id), eq(recurring.userId, userId)));
        links.set(row.id, c.transactionIds);
        updated++;
      } else {
        toInsert.push(c);
      }
    }

    if (toInsert.length > 0) {
      const inserted = await tx
        .insert(recurring)
        .values(
          toInsert.map((c) => ({
            userId,
            accountId: c.accountId,
            merchantKey: c.merchantKey,
            typicalAmountCents: c.typicalAmountCents,
            interval: c.interval,
            lastSeenDate: c.lastSeenDate,
            nextExpectedDate: c.nextExpectedDate,
            status: "detected" as const,
          })),
        )
        .returning({ id: recurring.id, accountId: recurring.accountId, merchantKey: recurring.merchantKey });
      const byKey = new Map(toInsert.map((c) => [itemKey(c.accountId, c.merchantKey), c]));
      for (const row of inserted) {
        const c = byKey.get(itemKey(row.accountId, row.merchantKey));
        if (c) links.set(row.id, c.transactionIds);
      }
      detected = inserted.length;
    }

    for (const row of existing) {
      if (row.status === "dismissed" || candidateKeys.has(itemKey(row.accountId, row.merchantKey))) continue;

      if (row.status === "detected" && !withOpenAlert.has(row.id)) {
        await tx
          .delete(recurring)
          .where(and(eq(recurring.id, row.id), eq(recurring.userId, userId)));
        removed++;
        continue;
      }

      // Confirmed, ended, or detected with an open price alert: keep it even when the
      // data stops qualifying. `recurring` stores no sign; the amount's sign tells.
      const sign: Sign = row.typicalAmountCents < 0 ? "out" : "in";
      const group = groupsByAccount.get(row.accountId)?.get(groupKey(row.merchantKey, sign));
      if (!group) {
        // Nothing left to vouch for: keeping it would project payments built
        // from deleted data. Dismissed items stay, so they are never re-suggested.
        await tx
          .delete(recurring)
          .where(and(eq(recurring.id, row.id), eq(recurring.userId, userId)));
        removed++;
        continue;
      }
      if (row.status === "ended") {
        // No newer charge (else it was revived above): stays as the user left it.
        links.set(
          row.id,
          group.txs.map((t) => t.id),
        );
        continue;
      }
      const fields =
        row.source === "manual"
          ? trackedFields(group.txs, row.interval)
          : { lastSeenDate: group.lastSeenDate, nextExpectedDate: nextExpectedDate(group.lastSeenDate, row.interval) };
      await tx
        .update(recurring)
        .set(fields)
        .where(and(eq(recurring.id, row.id), eq(recurring.userId, userId)));
      links.set(
        row.id,
        group.txs.map((t) => t.id),
      );
      updated++;
    }

    // Links are rebuilt from scratch so undone or no-longer-matching rows
    // never keep a stale pointer.
    await tx
      .update(transactions)
      .set({ recurringId: null })
      .where(and(eq(transactions.userId, userId), isNotNull(transactions.recurringId)));
    for (const [recurringId, ids] of links) {
      for (const part of chunk(ids, CHUNK_SIZE)) {
        await tx
          .update(transactions)
          .set({ recurringId })
          .where(and(eq(transactions.userId, userId), inArray(transactions.id, part)));
      }
    }

    return { detected, updated, removed, priceAlerts };
  });
}

export interface RecurringListItem extends Recurring {
  /** The merchant name for a named merchant; else the display label of the latest linked transaction, or the merchant key. */
  name: string;
  /** Set when the item is keyed by a merchant name: the UI links to the transactions with `?merchant=<id>`. */
  merchantId: string | null;
  /** Name of the item's account (the user's own data, not translated). */
  accountName: string;
  /** Icon of the latest linked charge's category when it is top-level; null otherwise (subcategories show none). */
  categoryIcon: string | null;
  /** Category (top-level or sub) of the latest linked charge; null when it has none. Used to match bills to budgets. */
  categoryId: string | null;
  /** True while the item has an open price alert (drives the "Price up" pill). */
  hasPriceAlert: boolean;
  /** Latest transaction date on the item's account: what "Cancelled?" is measured against. */
  accountLatestDate: string | null;
  /** Confirmed and two charges missed (see `isPossiblyCancelled`). */
  possiblyCancelled: boolean;
  /** Signed yearly amount (negative = outflow). */
  yearlyCents: number;
}

/**
 * The user's recurring items still running: confirmed first, then soonest due. Dismissed
 * items never appear unless `includeDismissed` (the Recurring page); ended ones only with
 * `includeEnded` (or `includeDismissed`), after the running ones and before dismissed, so
 * every projection built from this list leaves them out.
 */
export async function listRecurring(
  database: typeof dbClient,
  userId: string,
  options: { accountId?: string; includeEnded?: boolean; includeDismissed?: boolean } = {},
): Promise<RecurringListItem[]> {
  // Columns are written out qualified: drizzle drops table prefixes in
  // single-table selects, which would make the correlation ambiguous.
  const latestLabel = sql<string | null>`(
    select t.label_display from transactions t
    where t.recurring_id = "recurring"."id" and t.user_id = "recurring"."user_id"
    order by t.date desc, t.id desc
    limit 1
  )`;

  // Recurring items have no category of their own, so they borrow their latest charge's.
  const latestIcon = sql<string | null>`(
    select c.icon from transactions t
    join categories c on c.id = t.category_id and c.user_id = "recurring"."user_id"
    where t.recurring_id = "recurring"."id" and t.user_id = "recurring"."user_id"
    order by t.date desc, t.id desc
    limit 1
  )`;

  const latestCategoryId = sql<string | null>`(
    select c.id from transactions t
    join categories c on c.id = t.category_id and c.user_id = "recurring"."user_id"
    where t.recurring_id = "recurring"."id" and t.user_id = "recurring"."user_id"
    order by t.date desc, t.id desc
    limit 1
  )`;

  const hasPriceAlert = sql<boolean>`exists (
    select 1 from recurring_price_alerts a
    where a.recurring_id = "recurring"."id" and a.user_id = "recurring"."user_id" and a.status = 'open'
  )`;

  const accountLatestDate = sql<string | null>`(
    select max(t.date)::text from transactions t
    where t.account_id = "recurring"."account_id" and t.user_id = "recurring"."user_id"
  )`;

  const rows = await database
    .select({
      item: recurring,
      accountName: accounts.name,
      latestLabel,
      latestIcon,
      latestCategoryId,
      hasPriceAlert,
      accountLatestDate,
    })
    .from(recurring)
    .innerJoin(accounts, and(eq(accounts.id, recurring.accountId), eq(accounts.userId, userId)))
    .where(
      and(
        eq(recurring.userId, userId),
        options.includeDismissed
          ? undefined
          : options.includeEnded
            ? ne(recurring.status, "dismissed")
            : notInArray(recurring.status, ["dismissed", "ended"]),
        options.accountId ? eq(recurring.accountId, options.accountId) : undefined,
      ),
    )
    .orderBy(
      sql`case ${recurring.status} when 'confirmed' then 0 when 'detected' then 1 when 'ended' then 2 else 3 end`,
      sql`${recurring.endedAt} desc nulls last`,
      sql`${recurring.nextExpectedDate} asc nulls last`,
      asc(recurring.merchantKey),
    );

  const merchantNames = rows.some((r) => merchantIdOfKey(r.item.merchantKey) !== null)
    ? await loadMerchantNames(database, userId)
    : new Map<string, string>();

  return rows.map(({ item, accountName, latestLabel: label, latestIcon: icon, latestCategoryId: categoryId, hasPriceAlert: alert, accountLatestDate: latestDate }) => {
    const keyedId = merchantIdOfKey(item.merchantKey);
    const merchantName = keyedId === null ? undefined : merchantNames.get(keyedId);
    return {
      ...item,
      accountName,
      accountLatestDate: latestDate,
      possiblyCancelled: isPossiblyCancelled({ ...item, accountLatestDate: latestDate }),
      yearlyCents: yearlyCents(item.typicalAmountCents, item.interval),
      categoryIcon: icon,
      categoryId,
      hasPriceAlert: alert === true,
      merchantId: merchantName === undefined ? null : keyedId,
      name: merchantName ?? (label && label.trim() !== "" ? label : item.merchantKey),
    };
  });
}

/** Latest transaction date on the item's own account, as SQL for an update of `recurring`. */
const itemAccountLatestDate = sql<string | null>`(
  select max(t.date) from transactions t
  where t.account_id = "recurring"."account_id" and t.user_id = "recurring"."user_id"
)`;

export type RecurringStatusChange = "detected" | "confirmed" | "dismissed" | "ended";

type Tx = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];

/** Shared by the single and bulk setters; must run inside a transaction. */
async function applyStatus(
  tx: Tx,
  userId: string,
  id: string,
  status: RecurringStatusChange,
  endedOn?: string,
): Promise<Recurring | null> {
  const owned = and(eq(recurring.id, id), eq(recurring.userId, userId), ne(recurring.status, "dismissed"));
  const [current] = await tx.select({ status: recurring.status }).from(recurring).where(owned);
  if (!current) return null;

  const [row] = await tx
    .update(recurring)
    .set(
      status === "ended"
        ? { status, endedAt: endedOn ?? null, stillActiveAt: null }
        : status === "confirmed" && current.status === "ended"
          ? { status, endedAt: null, stillActiveAt: itemAccountLatestDate }
          : { status, endedAt: null },
    )
    .where(owned)
    .returning();
  if (!row) return null;

  if (status === "dismissed") {
    await tx
      .update(transactions)
      .set({ recurringId: null })
      .where(and(eq(transactions.userId, userId), eq(transactions.recurringId, id)));
  }
  if (status === "ended") {
    await tx
      .delete(recurringPriceAlerts)
      .where(
        and(
          eq(recurringPriceAlerts.userId, userId),
          eq(recurringPriceAlerts.recurringId, id),
          eq(recurringPriceAlerts.status, "open"),
        ),
      );
  }
  return row;
}

/**
 * Detects, confirms, dismisses or ends an item; confirming an ended item resumes it, and
 * going back to detected undoes a confirm. A dismissed item is only brought back by
 * `restoreRecurring`, so it isn't touched here. Dismissing also unlinks the item's
 * transactions. Ending stamps `endedOn` and drops its open price alert (an ended item
 * can't go up in price). Resuming counts as "Still active", so the "Cancelled?" flag that
 * probably led to the end doesn't come straight back.
 * Returns `null` when the item doesn't exist, isn't the user's, or is dismissed.
 */
export async function setRecurringStatus(
  database: typeof dbClient,
  userId: string,
  id: string,
  status: RecurringStatusChange,
  endedOn?: string,
): Promise<Recurring | null> {
  return database.transaction((tx) => applyStatus(tx, userId, id, status, endedOn));
}

/** Thrown inside the bulk transaction to roll it back. */
class NotChangedError extends Error {}

/**
 * Several status changes in one transaction, all or nothing: when any item is missing,
 * not the user's or dismissed, nothing is changed and `null` is returned.
 */
export async function setRecurringStatuses(
  database: typeof dbClient,
  userId: string,
  changes: { id: string; status: RecurringStatusChange; endedOn?: string }[],
): Promise<Recurring[] | null> {
  return database.transaction(async (tx) => {
    const rows: Recurring[] = [];
    for (const change of changes) {
      const row = await applyStatus(tx, userId, change.id, change.status, change.endedOn);
      if (!row) {
        throw new NotChangedError();
      }
      rows.push(row);
    }
    return rows;
  }).catch((error: unknown) => {
    if (error instanceof NotChangedError) return null;
    throw error;
  });
}

/**
 * Brings a dismissed item back (the user's Undo or "Restore"). Its transactions were
 * unlinked when it was dismissed, so the caller runs `refreshRecurring` afterwards to
 * link them again and refresh its dates. Returns `null` unless the user's item is dismissed.
 */
export async function restoreRecurring(
  database: typeof dbClient,
  userId: string,
  id: string,
  status: "detected" | "confirmed",
): Promise<Recurring | null> {
  const [row] = await database
    .update(recurring)
    .set({ status, endedAt: null, stillActiveAt: null })
    .where(and(eq(recurring.id, id), eq(recurring.userId, userId), eq(recurring.status, "dismissed")))
    .returning();
  return row ?? null;
}

export interface RecurringHistoryEntry {
  transactionId: string;
  date: string;
  amountCents: number;
}

/** The last `limit` charges linked to each item, newest first. */
export async function listRecurringHistory(
  database: typeof dbClient,
  userId: string,
  ids: string[],
  limit = 12,
): Promise<Map<string, RecurringHistoryEntry[]>> {
  const history = new Map<string, RecurringHistoryEntry[]>();
  if (ids.length === 0) return history;
  const ranked = database
    .select({
      recurringId: transactions.recurringId,
      transactionId: transactions.id,
      date: transactions.date,
      amountCents: transactions.amountCents,
      rank: sql<number>`row_number() over (partition by ${transactions.recurringId} order by ${transactions.date} desc, ${transactions.id} desc)`.as(
        "rank",
      ),
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), inArray(transactions.recurringId, ids)))
    .as("ranked");
  const rows = await database
    .select()
    .from(ranked)
    .where(sql`${ranked.rank} <= ${limit}`)
    .orderBy(asc(ranked.recurringId), asc(ranked.rank));
  for (const r of rows) {
    if (r.recurringId === null) continue;
    const entry = { transactionId: r.transactionId, date: r.date, amountCents: r.amountCents };
    const list = history.get(r.recurringId);
    if (list) list.push(entry);
    else history.set(r.recurringId, [entry]);
  }
  return history;
}

/**
 * "Still active" on a "Cancelled?" flag: remembers the account's latest transaction date,
 * so the flag stays hidden until another charge is missed after it. Confirmed items only.
 */
export async function markRecurringStillActive(
  database: typeof dbClient,
  userId: string,
  id: string,
): Promise<Recurring | null> {
  const [row] = await database
    .update(recurring)
    .set({ stillActiveAt: itemAccountLatestDate })
    .where(and(eq(recurring.id, id), eq(recurring.userId, userId), eq(recurring.status, "confirmed")))
    .returning();
  return row ?? null;
}

export interface TrackResult {
  id: string;
  /** The item's state before tracking, for Undo; null when tracking created it. */
  previous: { status: Recurring["status"]; endedAt: string | null } | null;
}

/**
 * Track as regular payment (Slice 53): a confirmed `manual` item following every payment with
 * this row's key and sign, whatever the amount. An item already on that key becomes the tracked
 * one. Null when the row isn't the user's or can't be tracked (ignored, transfer, no label).
 */
export async function trackRecurring(
  database: typeof dbClient,
  userId: string,
  transactionId: string,
): Promise<TrackResult | null> {
  const result = await database.transaction(async (tx) => {
    const usable = and(eq(transactions.userId, userId), notIgnored(), or(notInTransfer(userId), savingsSideLeg(userId)));
    const columns = {
      id: transactions.id,
      date: transactions.date,
      amountCents: transactions.amountCents,
      labelNormalized: transactions.labelNormalized,
      merchantId: transactions.merchantId,
    };
    const [row] = await tx
      .select({ ...columns, accountId: transactions.accountId })
      .from(transactions)
      .where(and(usable, eq(transactions.id, transactionId)));
    if (!row || row.amountCents === 0) return null;
    const key = txMerchantKey(row);
    if (key === null) return null;

    const accountRows = await tx.select(columns).from(transactions).where(and(usable, eq(transactions.accountId, row.accountId)));
    const group = groupTransactions(accountRows).get(groupKey(key, row.amountCents < 0 ? "out" : "in"));
    if (!group) return null;

    const [existing] = await tx
      .select({ status: recurring.status, endedAt: recurring.endedAt })
      .from(recurring)
      .where(and(eq(recurring.userId, userId), eq(recurring.accountId, row.accountId), eq(recurring.merchantKey, key)));
    const fields = trackedFields(group.txs, "monthly");
    const tracked = { ...fields, status: "confirmed" as const, source: "manual" as const };
    const [item] = await tx
      .insert(recurring)
      .values({ userId, accountId: row.accountId, merchantKey: key, ...tracked })
      .onConflictDoUpdate({
        target: [recurring.userId, recurring.accountId, recurring.merchantKey],
        set: { ...tracked, endedAt: null, stillActiveAt: null },
      })
      .returning({ id: recurring.id });
    await tx
      .delete(recurringPriceAlerts)
      .where(
        and(
          eq(recurringPriceAlerts.userId, userId),
          eq(recurringPriceAlerts.recurringId, item.id),
          eq(recurringPriceAlerts.status, "open"),
        ),
      );
    return { id: item.id, previous: existing ?? null };
  });
  if (result) await refreshRecurring(database, userId);
  return result;
}

/**
 * Stop tracking, or Undo of Track: the item goes back to detection's hands with `restore`'s status
 * (`detected` when null); the refresh then removes it if detection no longer finds it.
 */
export async function untrackRecurring(
  database: typeof dbClient,
  userId: string,
  id: string,
  restore: TrackResult["previous"],
): Promise<boolean> {
  const status = restore?.status ?? "detected";
  const [row] = await database
    .update(recurring)
    .set({ source: "detected", status, endedAt: status === "ended" ? (restore?.endedAt ?? null) : null })
    .where(and(eq(recurring.id, id), eq(recurring.userId, userId), eq(recurring.source, "manual")))
    .returning({ id: recurring.id });
  if (!row) return false;
  await refreshRecurring(database, userId);
  return true;
}
