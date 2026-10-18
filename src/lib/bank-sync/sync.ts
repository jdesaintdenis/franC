import { assignDedupeKeys } from "../import/dedupe";
import { currentDate } from "../dashboard/month";

import type { EnableBankingClient, PsuContext } from "./client";
import { convertBankTransactions } from "./convert";
import { pickBookedBalance, type PickedBalance } from "./balance";
import { BankSyncError, type BankSyncErrorCode } from "./errors";
import { learnShortLabels } from "./short-label";
import { defaultSyncFrom, fetchFrom } from "./window";

export type SyncLink = {
  accountId: string;
  bankAccountUid: string;
  bankName: string;
  /** Null until the link step saved one (links from Slice 45): the default applies. */
  syncFrom: string | null;
  lastSyncedAt: Date | null;
};

export type SyncCommitInput = {
  userId: string;
  accountId: string;
  filename: string;
  rowsTotal: number;
  rowsError: number;
  rows: Array<ReturnType<typeof assignDedupeKeys>[number] & { externalId: string | null }>;
  /** The bank's booked balance, saved in the same DB transaction as the rows. Null when none was read. */
  balance: (PickedBalance & { bankName: string; fetchedAt: Date }) | null;
};

/** The persistence a sync needs, injected so the flow is tested without a database. */
export type SyncStore = {
  findLink(userId: string, linkId: string): Promise<SyncLink | null>;
  newestTransactionDate(userId: string, accountId: string): Promise<string | null>;
  /** The account's CSV rows (long label, short label, date): what teaches synced rows their short label. */
  csvLabels(userId: string, accountId: string): Promise<Array<{ labelRaw: string; labelSimplified: string; date: string }>>;
  /** Inserts what is new and merges what a CSV already brought in (the matcher runs inside the commit). */
  commit(input: SyncCommitInput): Promise<{ importId: string; inserted: number; duplicate: number; possible: number }>;
  markSynced(userId: string, linkId: string, input: { at: Date; syncFrom: string }): Promise<void>;
};

export type SyncResult =
  | {
      ok: true;
      importId: string;
      inserted: number;
      /** Rows already in franC: same bank id or hash, or merged into a CSV row. */
      duplicate: number;
      /** Inserted rows that may duplicate several existing ones, left for Review. */
      possible: number;
      /** Rows the bank sent that couldn't be read: reported, never dropped silently. */
      errors: number;
    }
  | { ok: false; error: BankSyncErrorCode | "linkNotFound" };

/**
 * Sync now for one linked bank account: fetch booked transactions since the start date (with an
 * overlap), convert them to CSV-shaped rows and commit them like an import, in one DB transaction.
 */
export async function syncAccount(
  deps: { client: EnableBankingClient; store: SyncStore; now: Date; psu?: PsuContext },
  userId: string,
  linkId: string,
): Promise<SyncResult> {
  const { client, store, now } = deps;
  const link = await store.findLink(userId, linkId);
  if (!link) return { ok: false, error: "linkNotFound" };

  const today = currentDate(now);
  const syncFrom = link.syncFrom ?? defaultSyncFrom(today, await store.newestTransactionDate(userId, link.accountId));
  const dateFrom = fetchFrom({
    today,
    syncFrom,
    lastSyncedOn: link.lastSyncedAt ? currentDate(link.lastSyncedAt) : null,
  });

  let transactions;
  try {
    transactions = await client.getTransactions(link.bankAccountUid, { dateFrom, status: "BOOK", psu: deps.psu });
  } catch (error) {
    if (error instanceof BankSyncError) return { ok: false, error: error.code };
    throw error;
  }

  // A failed balance call only skips the checkpoint: the transactions are still worth importing.
  let balance: SyncCommitInput["balance"] = null;
  try {
    const picked = pickBookedBalance(await client.getBalances(link.bankAccountUid, { psu: deps.psu }), now);
    balance = picked && { ...picked, bankName: link.bankName, fetchedAt: now };
  } catch (error) {
    if (!(error instanceof BankSyncError)) throw error;
  }

  const learned = learnShortLabels(await store.csvLabels(userId, link.accountId));
  const converted = convertBankTransactions(transactions, learned);
  const keyed = assignDedupeKeys(converted.rows, link.accountId);

  const committed = await store.commit({
    userId,
    accountId: link.accountId,
    filename: link.bankName,
    rowsTotal: converted.rows.length + converted.errors.length,
    rowsError: converted.errors.length,
    balance,
    rows: keyed.map((row, i) => ({ ...row, externalId: converted.rows[i].externalId })),
  });
  await store.markSynced(userId, linkId, { at: now, syncFrom });

  return {
    ok: true,
    importId: committed.importId,
    inserted: committed.inserted,
    duplicate: committed.duplicate,
    possible: committed.possible,
    errors: converted.errors.length,
  };
}
