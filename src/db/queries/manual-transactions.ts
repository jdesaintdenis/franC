import { and, asc, count, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";

import { categorizeLabel } from "../../lib/categorize/rules";
import { normalizeLabel } from "../../lib/import/normalize-label";
import { NOT_FOUND_AFTER_DAYS } from "../../lib/manual/not-found";
import type { ManualInput } from "../../lib/manual/input";
import { resolveMerchant } from "../../lib/merchants/match";
import { addDays, daysBetween } from "../../lib/recurring/dates";
import type { db as dbClient } from "../client";
import { accounts, categories, tags, transactionSplits, transactionTags, transactions, transfers } from "../schema";
import { getFrancImportId } from "./accounts";
import { loadCompiledRules } from "./category-rules";
import { loadMerchantLookup } from "./merchants";
import { notSplit } from "./split-sql";
import { notIgnored, notInTransfer } from "./transfer-sql";
import { selectListItemRows, toListItems, type TransactionListItem } from "./transactions";

type Tx = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];

export type ManualWriteError = "notFound" | "notCurrent" | "isSplit" | "isTransfer";

/** The window, either way, for a bank row a not-found hand row may be linked to. */
const LINK_WINDOW_DAYS = 7;
const MAX_LINK_CANDIDATES = 20;

/**
 * True when the account is fed: it has a bank link to a connection that reached the bank, or at least one CSV or
 * sync import. Rows added by hand to such an account wait for the bank (Slice 56). Scoped by user_id.
 */
export async function isAccountFed(database: Pick<typeof dbClient, "execute">, userId: string, accountId: string) {
  const rows: Array<{ fed: boolean }> = await database.execute(sql`
    select (
      exists (
        select 1 from bank_account_links l
        join bank_connections c on c.id = l.connection_id and c.user_id = l.user_id
        where l.account_id = ${accountId} and l.user_id = ${userId} and c.status <> 'pending'
      ) or exists (
        select 1 from imports i
        where i.account_id = ${accountId} and i.user_id = ${userId} and i.kind in ('csv', 'sync')
      )
    ) as fed
  `);
  return rows[0]?.fed === true;
}

export interface CreateManualInput extends ManualInput {
  accountId: string;
  categoryId: string | null;
  /** Only with a category (Undo of a delete puts it back). */
  categorySource?: "manual" | "rule" | "bank" | "guess" | null;
  note?: string | null;
  tagIds?: string[];
}

export type CreateManualResult =
  | { ok: true; id: string; awaitingBank: boolean }
  | { ok: false; error: "notFound" | "notCurrent" };

/**
 * Adds a row by hand to one of the user's Current accounts, in one transaction. It sits in the account's hidden
 * franC import, is reviewed, and waits for the bank when the account is fed. Without a category the user's rules
 * and merchant names apply to the label, like an imported row.
 */
export async function createManualTransaction(
  database: typeof dbClient,
  userId: string,
  input: CreateManualInput,
): Promise<CreateManualResult> {
  return database.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id, savings: accounts.savings })
      .from(accounts)
      .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, userId)))
      .for("update");
    if (!account) return { ok: false as const, error: "notFound" as const };
    if (account.savings) return { ok: false as const, error: "notCurrent" as const };

    if (input.categoryId !== null) {
      const [owned] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, input.categoryId), eq(categories.userId, userId)));
      if (!owned) return { ok: false as const, error: "notFound" as const };
    }

    const awaitingBank = await isAccountFed(tx, userId, input.accountId);
    const importId = await getFrancImportId(tx, userId, input.accountId);
    const id = crypto.randomUUID();
    const normalized = normalizeLabel(input.label);

    let categoryId = input.categoryId;
    let categorySource: "manual" | "rule" | "bank" | "guess" | null =
      categoryId === null ? null : (input.categorySource ?? "manual");
    let merchantId: string | null = null;
    const lookup = await loadMerchantLookup(tx, userId);
    merchantId = resolveMerchant(lookup.patterns, { normalized, display: input.label });
    if (categoryId === null) {
      const rules = await loadCompiledRules(tx, userId);
      const ruleCategoryId = categorizeLabel(rules, {
        normalized,
        display: input.label,
        merchant: merchantId === null ? null : (lookup.names.get(merchantId) ?? null),
      });
      if (ruleCategoryId !== null) {
        categoryId = ruleCategoryId;
        categorySource = "rule";
      }
    }

    await tx.insert(transactions).values({
      id,
      userId,
      accountId: input.accountId,
      importId,
      date: input.date,
      amountCents: input.amountCents,
      labelRaw: input.label,
      labelNormalized: normalized,
      labelDisplay: input.label,
      merchantId,
      categoryId,
      categorySource,
      // Without a category the row waits in the review queue (SPEC §73 A).
      reviewedAt: categoryId === null ? null : sql`now()`,
      note: input.note ?? null,
      dedupeHash: `manual:${id}`,
      occurrenceIndex: 0,
      source: "manual",
      awaitingBank,
    });

    const wanted = [...new Set(input.tagIds ?? [])];
    if (wanted.length > 0) {
      const owned = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.userId, userId), inArray(tags.id, wanted)));
      if (owned.length > 0) {
        await tx.insert(transactionTags).values(owned.map((t) => ({ transactionId: id, tagId: t.id, userId })));
      }
    }
    return { ok: true as const, id, awaitingBank };
  });
}

async function hasSplitOrTransfer(tx: Pick<typeof dbClient, "select">, userId: string, id: string) {
  const [{ value: splits }] = await tx
    .select({ value: count() })
    .from(transactionSplits)
    .where(and(eq(transactionSplits.userId, userId), eq(transactionSplits.transactionId, id)));
  const [{ value: transferLegs }] = await tx
    .select({ value: count() })
    .from(transfers)
    .where(
      and(
        eq(transfers.userId, userId),
        sql`(${transfers.outTransactionId} = ${id} or ${transfers.inTransactionId} = ${id})`,
      ),
    );
  return { split: splits > 0, transfer: transferLegs > 0 };
}

/** Edits a row added by hand. A change of amount is refused while it is split or a transfer leg. */
export async function updateManualTransaction(
  database: typeof dbClient,
  userId: string,
  id: string,
  input: ManualInput,
): Promise<{ ok: true } | { ok: false; error: ManualWriteError }> {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select({ amountCents: transactions.amountCents })
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId), eq(transactions.source, "manual")))
      .for("update");
    if (!row) return { ok: false as const, error: "notFound" as const };
    if (row.amountCents !== input.amountCents) {
      const links = await hasSplitOrTransfer(tx, userId, id);
      if (links.split) return { ok: false as const, error: "isSplit" as const };
      if (links.transfer) return { ok: false as const, error: "isTransfer" as const };
    }
    await tx
      .update(transactions)
      .set({
        date: input.date,
        amountCents: input.amountCents,
        labelRaw: input.label,
        labelDisplay: input.label,
        labelNormalized: normalizeLabel(input.label),
      })
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    return { ok: true as const };
  });
}

/** What Undo of a delete needs to put the row back (it gets a new id; splits and links are not restored). */
export interface ManualSnapshot {
  accountId: string;
  date: string;
  amountCents: number;
  label: string;
  categoryId: string | null;
  categorySource: "manual" | "rule" | "bank" | "guess" | null;
  note: string | null;
  tagIds: string[];
}

/** Deletes a row added by hand and returns its snapshot; null when it isn't the user's or wasn't added by hand. */
export async function deleteManualTransaction(
  database: typeof dbClient,
  userId: string,
  id: string,
): Promise<ManualSnapshot | null> {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId), eq(transactions.source, "manual")))
      .for("update");
    if (!row) return null;
    const tagRows = await tx
      .select({ tagId: transactionTags.tagId })
      .from(transactionTags)
      .where(and(eq(transactionTags.userId, userId), eq(transactionTags.transactionId, id)));
    await tx.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    return {
      accountId: row.accountId,
      date: row.date,
      amountCents: row.amountCents,
      label: row.labelDisplay ?? row.labelRaw ?? "",
      categoryId: row.categoryId,
      categorySource: row.categorySource,
      note: row.note,
      tagIds: tagRows.map((t) => t.tagId),
    };
  });
}

function notFoundWhere(userId: string, today: string) {
  return and(
    eq(transactions.userId, userId),
    eq(transactions.source, "manual"),
    eq(transactions.awaitingBank, true),
    notIgnored(),
    lt(transactions.date, addDays(today, -NOT_FOUND_AFTER_DAYS)),
  );
}

/** Rows added by hand, still waiting for the bank more than 7 days later, oldest first. Scoped by user_id. */
export async function listNotFound(
  database: typeof dbClient,
  userId: string,
  today: string,
): Promise<TransactionListItem[]> {
  const rows = await selectListItemRows(database, userId)
    .where(notFoundWhere(userId, today))
    .orderBy(asc(transactions.date), asc(transactions.id));
  return toListItems(database, userId, rows);
}

export async function countNotFound(database: typeof dbClient, userId: string, today: string): Promise<number> {
  const [row] = await database.select({ value: count() }).from(transactions).where(notFoundWhere(userId, today));
  return row?.value ?? 0;
}

/** Keep: the row stops waiting and becomes final. False when it isn't a waiting row of the user's. */
export async function setAwaitingBank(
  database: typeof dbClient,
  userId: string,
  id: string,
  awaitingBank: boolean,
): Promise<boolean> {
  const rows = await database
    .update(transactions)
    .set({ awaitingBank })
    .where(
      and(
        eq(transactions.id, id),
        eq(transactions.userId, userId),
        eq(transactions.source, "manual"),
        eq(transactions.awaitingBank, !awaitingBank),
      ),
    )
    .returning({ id: transactions.id });
  return rows.length > 0;
}

export interface LinkCandidate {
  id: string;
  date: string;
  amountCents: number;
  label: string;
}

/** Bank rows (CSV or sync) of the same account and sign, within 7 days, that a hand row could be. */
function candidateWhere(userId: string, manual: { accountId: string; amountCents: number; date: string }) {
  return and(
    eq(transactions.userId, userId),
    eq(transactions.accountId, manual.accountId),
    inArray(transactions.source, ["csv", "sync"]),
    notIgnored(),
    notInTransfer(userId),
    notSplit(userId),
    manual.amountCents < 0 ? lt(transactions.amountCents, 0) : gt(transactions.amountCents, 0),
    gte(transactions.date, addDays(manual.date, -LINK_WINDOW_DAYS)),
    lte(transactions.date, addDays(manual.date, LINK_WINDOW_DAYS)),
  );
}

export async function listLinkCandidates(
  database: typeof dbClient,
  userId: string,
  id: string,
): Promise<LinkCandidate[]> {
  const [manual] = await database
    .select({ accountId: transactions.accountId, amountCents: transactions.amountCents, date: transactions.date })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId), eq(transactions.source, "manual")));
  if (!manual) return [];
  const rows = await database
    .select({
      id: transactions.id,
      date: transactions.date,
      amountCents: transactions.amountCents,
      label: transactions.labelDisplay,
      raw: transactions.labelRaw,
    })
    .from(transactions)
    .where(candidateWhere(userId, manual));
  return rows
    .map((r) => ({ id: r.id, date: r.date, amountCents: r.amountCents, label: r.label ?? r.raw ?? "" }))
    .sort((a, b) => Math.abs(daysBetween(manual.date, a.date)) - Math.abs(daysBetween(manual.date, b.date)))
    .slice(0, MAX_LINK_CANDIDATES);
}

export type LinkResult =
  | { ok: true; droppedSplit: boolean }
  | { ok: false; error: "notFound" | "isTransfer" };

/**
 * Same as…: a hand row that never matched is the bank row picked by the user. The bank row takes the hand row's
 * category (as manual), note and tags and is marked reviewed; the hand row is deleted with its split. A hand row
 * that is a transfer leg is refused (deleting it would delete the Savings row created with it).
 */
export async function linkManualToBankRow(
  database: typeof dbClient,
  userId: string,
  manualId: string,
  bankRowId: string,
): Promise<LinkResult> {
  return database.transaction(async (tx: Tx) => {
    const [manual] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, manualId), eq(transactions.userId, userId), eq(transactions.source, "manual")))
      .for("update");
    if (!manual) return { ok: false as const, error: "notFound" as const };
    const [bank] = await tx
      .select({ id: transactions.id, note: transactions.note })
      .from(transactions)
      .where(and(eq(transactions.id, bankRowId), candidateWhere(userId, manual)))
      .for("update");
    if (!bank) return { ok: false as const, error: "notFound" as const };
    const links = await hasSplitOrTransfer(tx, userId, manualId);
    if (links.transfer) return { ok: false as const, error: "isTransfer" as const };

    await tx
      .update(transactions)
      .set({
        ...(manual.categoryId !== null ? { categoryId: manual.categoryId, categorySource: "manual" as const } : {}),
        ...(manual.note !== null && bank.note === null ? { note: manual.note } : {}),
        reviewedAt: sql`coalesce(${transactions.reviewedAt}, now())`,
      })
      .where(and(eq(transactions.id, bank.id), eq(transactions.userId, userId)));
    const manualTags = await tx
      .select({ tagId: transactionTags.tagId })
      .from(transactionTags)
      .where(and(eq(transactionTags.userId, userId), eq(transactionTags.transactionId, manualId)));
    if (manualTags.length > 0) {
      await tx
        .insert(transactionTags)
        .values(manualTags.map((t) => ({ transactionId: bank.id, tagId: t.tagId, userId })))
        .onConflictDoNothing();
    }
    await tx.delete(transactions).where(and(eq(transactions.id, manualId), eq(transactions.userId, userId)));
    return { ok: true as const, droppedSplit: links.split };
  });
}

/**
 * A fingerprint of the user's rows added by hand. A list that holds loaded rows compares it to see that a row was
 * added, edited, deleted or linked since it loaded, and swaps its rows for fresh ones.
 */
export async function manualVersion(database: Pick<typeof dbClient, "execute">, userId: string): Promise<string> {
  const rows: Array<{ v: string | null }> = await database.execute(sql`
    select md5(string_agg(
      t.id::text || t.date::text || t.amount_cents::text || coalesce(t.label_display, '') || t.awaiting_bank::text,
      ',' order by t.id
    )) as v
    from transactions t
    where t.user_id = ${userId} and t.source = 'manual'
  `);
  return rows[0]?.v ?? "";
}
