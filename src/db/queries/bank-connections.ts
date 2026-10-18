import { and, asc, desc, eq, inArray, isNotNull, lt, max, ne } from "drizzle-orm";

import { parseAccountName } from "../../lib/accounts/name";
import type { ConnectStore } from "../../lib/bank-sync/connect";
import { connectionHealth, type ConnectionHealth } from "../../lib/bank-sync/health";
import { matchReconnectedAccounts, uniqueAccountName, type LinkChoice } from "../../lib/bank-sync/link";
import type { db as dbClient } from "../client";
import { promoteLatestBankCheckpoints } from "./balance-checkpoints";
import { accounts, bankAccountLinks, bankConnections, imports, transactions, type BankConnectionStatus } from "../schema";

type Executor = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];
type Database = typeof dbClient | Executor;

// Every query here is scoped by userId: connections and links are per-user data.

/** The connect flow's persistence, over Drizzle. */
export function bankConnectionStore(database: typeof dbClient): ConnectStore {
  return {
    async deletePendingBefore(userId, before) {
      await database
        .delete(bankConnections)
        .where(
          and(
            eq(bankConnections.userId, userId),
            eq(bankConnections.status, "pending"),
            lt(bankConnections.createdAt, before),
          ),
        );
    },
    async createPending(userId, input) {
      await database.insert(bankConnections).values({ userId, ...input, status: "pending" });
    },
    async ownsConnection(userId, connectionId) {
      const [row] = await database
        .select({ id: bankConnections.id })
        .from(bankConnections)
        .where(
          and(
            eq(bankConnections.id, connectionId),
            eq(bankConnections.userId, userId),
            ne(bankConnections.status, "pending"),
          ),
        )
        .limit(1);
      return row !== undefined;
    },
    async findPendingByState(userId, state) {
      const [row] = await database
        .select({
          id: bankConnections.id,
          validUntil: bankConnections.validUntil,
          replacesConnectionId: bankConnections.replacesConnectionId,
        })
        .from(bankConnections)
        .where(
          and(
            eq(bankConnections.userId, userId),
            eq(bankConnections.authState, state),
            eq(bankConnections.status, "pending"),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async deletePending(userId, id) {
      await database
        .delete(bankConnections)
        .where(
          and(eq(bankConnections.id, id), eq(bankConnections.userId, userId), eq(bankConnections.status, "pending")),
        );
    },
    async activate(userId, id, input) {
      return database.transaction(async (tx) => {
        // Matching on status 'pending' makes a replayed callback a no-op instead of a second session.
        const [updated] = await tx
          .update(bankConnections)
          .set({
            status: "active",
            authState: null,
            sessionId: input.sessionId,
            validUntil: input.validUntil,
            connectedAt: input.connectedAt,
          })
          .where(
            and(eq(bankConnections.id, id), eq(bankConnections.userId, userId), eq(bankConnections.status, "pending")),
          )
          .returning({ id: bankConnections.id, replaces: bankConnections.replacesConnectionId });
        const none = { reconnected: false, replacedSessionId: null };
        if (!updated || input.accounts.length === 0) return none;
        const created = await tx
          .insert(bankAccountLinks)
          .values(input.accounts.map((a) => ({ userId, connectionId: id, ...a })))
          .onConflictDoNothing()
          .returning({ id: bankAccountLinks.id, uid: bankAccountLinks.bankAccountUid });
        return updated.replaces ? reconnectLinks(tx, userId, id, updated.replaces, input.accounts, created) : none;
      });
    },
  };
}

/**
 * Reconnect, inside the activating transaction: pairs the new session's accounts with the old
 * connection's links, moves their franC account and sync state over, then deletes the old
 * connection. Only `bank_account_links` cascade from a connection, so transactions, matches and
 * balance checkpoints (all per franC account) are untouched.
 */
async function reconnectLinks(
  tx: Executor,
  userId: string,
  newId: string,
  oldId: string,
  accountsIn: ReadonlyArray<{ bankAccountUid: string; displayName: string; ibanLast4: string | null; identificationHash?: string | null }>,
  created: ReadonlyArray<{ id: string; uid: string }>,
): Promise<{ reconnected: boolean; replacedSessionId: string | null }> {
  const [old] = await tx
    .select({ sessionId: bankConnections.sessionId })
    .from(bankConnections)
    .where(and(eq(bankConnections.id, oldId), eq(bankConnections.userId, userId), ne(bankConnections.id, newId)));
  if (!old) return { reconnected: false, replacedSessionId: null };

  const oldLinks = await tx
    .select()
    .from(bankAccountLinks)
    .where(and(eq(bankAccountLinks.connectionId, oldId), eq(bankAccountLinks.userId, userId)));
  const wasLinked = oldLinks.filter((l) => l.linkedAt !== null);
  const matches = matchReconnectedAccounts(
    wasLinked.map((l) => ({ ...l, identificationHash: l.identificationHash })),
    accountsIn.map((a) => ({ ...a, identificationHash: a.identificationHash ?? null })),
  );
  const newIdByUid = new Map(created.map((c) => [c.uid, c.id]));
  const oldById = new Map(wasLinked.map((l) => [l.id, l]));

  // Frees the franC accounts the old links held (unique index) before the new links take them.
  await tx.delete(bankConnections).where(and(eq(bankConnections.id, oldId), eq(bankConnections.userId, userId)));

  const allFound = wasLinked.filter((l) => l.accountId !== null).every((l) => [...matches.values()].includes(l.id));
  const now = new Date();
  for (const [uid, linkId] of newIdByUid) {
    const previous = oldById.get(matches.get(uid) ?? "");
    const carried = previous
      ? {
          accountId: previous.accountId,
          syncFrom: previous.syncFrom,
          lastSyncedAt: previous.lastSyncedAt,
          linkedAt: previous.linkedAt,
        }
      : allFound
        ? { linkedAt: now }
        : null;
    if (!carried) continue;
    await tx
      .update(bankAccountLinks)
      .set(carried)
      .where(and(eq(bankAccountLinks.id, linkId), eq(bankAccountLinks.userId, userId)));
  }
  await tx
    .update(bankConnections)
    .set({ replacesConnectionId: null })
    .where(and(eq(bankConnections.id, newId), eq(bankConnections.userId, userId)));
  return { reconnected: true, replacedSessionId: old.sessionId };
}

/** Whether any account of the user is fed by a bank link: shows the sync line and sync on open. */
export async function hasConnectedAccount(database: Database, userId: string): Promise<boolean> {
  const rows = await database
    .select({ id: bankAccountLinks.id })
    .from(bankAccountLinks)
    .innerJoin(bankConnections, eq(bankConnections.id, bankAccountLinks.connectionId))
    .where(
      and(
        eq(bankAccountLinks.userId, userId),
        eq(bankConnections.userId, userId),
        inArray(bankConnections.status, ["active", "expired"]),
        isNotNull(bankAccountLinks.accountId),
        isNotNull(bankAccountLinks.linkedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface BankLinkView {
  id: string;
  bankAccountUid: string;
  displayName: string;
  ibanLast4: string | null;
  accountId: string | null;
  accountName: string | null;
  linked: boolean;
  /** First day Sync now brings in; null until saved in the link step. */
  syncFrom: string | null;
  lastSyncedAt: Date | null;
  /** Linked and feeding a franC account: the only links that sync. */
  imported: boolean;
  lastAttemptAt: Date | null;
  /** Error code of the last attempt (`unauthorized`, `rate_limited`, …); null after a success. */
  lastError: string | null;
  failingSince: Date | null;
}

export interface BankConnectionView {
  id: string;
  aspspName: string;
  aspspCountry: string;
  status: BankConnectionStatus;
  validUntil: Date;
  connectedAt: Date | null;
  links: BankLinkView[];
  health: ConnectionHealth;
}

/** The user's connections that reached the bank (pending ones are in-flight logins, not shown). */
export async function listBankConnections(
  database: Database,
  userId: string,
  now: Date = new Date(),
): Promise<BankConnectionView[]> {
  const rows = await database
    .select({
      connection: bankConnections,
      link: bankAccountLinks,
      accountName: accounts.name,
    })
    .from(bankConnections)
    .leftJoin(
      bankAccountLinks,
      and(eq(bankAccountLinks.connectionId, bankConnections.id), eq(bankAccountLinks.userId, userId)),
    )
    .leftJoin(accounts, and(eq(accounts.id, bankAccountLinks.accountId), eq(accounts.userId, userId)))
    .where(and(eq(bankConnections.userId, userId), inArray(bankConnections.status, ["active", "expired", "failed"])))
    .orderBy(asc(bankConnections.createdAt), asc(bankAccountLinks.displayName));

  const byId = new Map<string, BankConnectionView>();
  for (const { connection, link, accountName } of rows) {
    let view = byId.get(connection.id);
    if (!view) {
      view = {
        id: connection.id,
        aspspName: connection.aspspName,
        aspspCountry: connection.aspspCountry,
        status: connection.status,
        validUntil: connection.validUntil,
        connectedAt: connection.connectedAt,
        links: [],
        health: { kind: "never" },
      };
      byId.set(connection.id, view);
    }
    if (link) {
      view.links.push({
        id: link.id,
        bankAccountUid: link.bankAccountUid,
        displayName: link.displayName,
        ibanLast4: link.ibanLast4,
        accountId: link.accountId,
        accountName: accountName ?? null,
        linked: link.linkedAt !== null,
        syncFrom: link.syncFrom,
        lastSyncedAt: link.lastSyncedAt,
        imported: link.linkedAt !== null && link.accountId !== null,
        lastAttemptAt: link.lastAttemptAt,
        lastError: link.lastError,
        failingSince: link.failingSince,
      });
    }
  }
  const views = [...byId.values()];
  for (const v of views) v.health = connectionHealth({ status: v.status, validUntil: v.validUntil, links: v.links, now });
  return views;
}

export type SaveLinksResult = { ok: true } | { ok: false; error: "notFound" | "accountTaken" | "invalidName" };

/**
 * Saves the link step in one transaction: creates the new accounts, points each bank account at its
 * franC account (or none), and marks them linked. An existing account must be the user's and not
 * fed by another bank account.
 */
export async function saveBankLinks(
  database: typeof dbClient,
  userId: string,
  connectionId: string,
  // `syncFrom` is the start date from the link step, already clamped by the caller.
  choices: ReadonlyArray<{ linkId: string; choice: LinkChoice; syncFrom?: string | null }>,
): Promise<SaveLinksResult> {
  try {
    return await database.transaction(async (tx) => {
      const links = await tx
        .select({ id: bankAccountLinks.id, accountId: bankAccountLinks.accountId, syncFrom: bankAccountLinks.syncFrom })
        .from(bankAccountLinks)
        .innerJoin(bankConnections, eq(bankConnections.id, bankAccountLinks.connectionId))
        .where(
          and(
            eq(bankAccountLinks.userId, userId),
            eq(bankAccountLinks.connectionId, connectionId),
            eq(bankConnections.userId, userId),
            eq(bankConnections.status, "active"),
          ),
        );
      const linkIds = new Set(links.map((l) => l.id));
      if (choices.length === 0 || choices.some((c) => !linkIds.has(c.linkId))) return { ok: false, error: "notFound" };

      const owned = await tx
        .select({ id: accounts.id, name: accounts.name, savings: accounts.savings })
        .from(accounts)
        .where(eq(accounts.userId, userId))
        .for("update");
      // A Savings account takes no bank link (Slice 52): treated like an account that isn't there.
      const ownedIds = new Set(owned.filter((a) => !a.savings).map((a) => a.id));
      const names = owned.map((a) => a.name);
      const wanted = choices.filter((c) => c.choice.kind === "existing").map((c) => (c.choice as { accountId: string }).accountId);
      if (wanted.some((id) => !ownedIds.has(id))) return { ok: false, error: "notFound" };
      if (new Set(wanted).size !== wanted.length) return { ok: false, error: "accountTaken" };

      // Free the accounts these links held, so swapping two links in one save doesn't trip the unique index.
      await tx
        .update(bankAccountLinks)
        .set({ accountId: null })
        .where(
          and(
            eq(bankAccountLinks.userId, userId),
            inArray(
              bankAccountLinks.id,
              choices.map((c) => c.linkId),
            ),
          ),
        );
      if (wanted.length > 0) {
        const takenElsewhere = await tx
          .select({ id: bankAccountLinks.id })
          .from(bankAccountLinks)
          .where(
            and(
              eq(bankAccountLinks.userId, userId),
              isNotNull(bankAccountLinks.accountId),
              inArray(bankAccountLinks.accountId, wanted),
            ),
          )
          .limit(1);
        if (takenElsewhere.length > 0) throw new LinkConflict();
      }

      const before = new Map(links.map((l) => [l.id, l]));
      const linkedAt = new Date();
      for (const { linkId, choice, syncFrom } of choices) {
        let accountId: string | null = null;
        if (choice.kind === "existing") accountId = choice.accountId;
        if (choice.kind === "new") {
          const parsed = parseAccountName(choice.name);
          if (!parsed.ok) throw new InvalidName();
          const name = uniqueAccountName(parsed.name, names);
          names.push(name);
          const [created] = await tx.insert(accounts).values({ userId, name }).returning({ id: accounts.id });
          accountId = created.id;
        }
        // Feeding another account starts over: its own start date, and a first sync.
        const previous = before.get(linkId);
        const moved = previous?.accountId !== accountId;
        await tx
          .update(bankAccountLinks)
          .set({
            accountId,
            linkedAt,
            syncFrom: syncFrom ?? (moved ? null : (previous?.syncFrom ?? null)),
            ...(moved ? { lastSyncedAt: null } : {}),
          })
          .where(and(eq(bankAccountLinks.id, linkId), eq(bankAccountLinks.userId, userId)));
      }
      return { ok: true } as const;
    });
  } catch (error) {
    // Thrown (not returned) so the transaction rolls back the accounts it already created.
    if (error instanceof LinkConflict) return { ok: false, error: "accountTaken" };
    if (error instanceof InvalidName) return { ok: false, error: "invalidName" };
    throw error;
  }
}

class LinkConflict extends Error {}
class InvalidName extends Error {}

/**
 * Deletes a connection and its links. Transactions and accounts are untouched. Returns the session
 * id so the caller can end it at Enable Banking too, or null when there was nothing to delete.
 */
export async function deleteBankConnection(
  database: Database,
  userId: string,
  connectionId: string,
): Promise<{ sessionId: string | null } | null> {
  return database.transaction(async (tx) => {
    // Before the links go: each linked account keeps its last bank balance as its manual one.
    await promoteLatestBankCheckpoints(tx, userId, connectionId);
    const [deleted] = await tx
      .delete(bankConnections)
      .where(and(eq(bankConnections.id, connectionId), eq(bankConnections.userId, userId)))
      .returning({ sessionId: bankConnections.sessionId });
    return deleted ?? null;
  });
}

/** franC account id → bank name, for the "Linked to …" line on the Accounts page. */
export async function linkedBankByAccount(database: Database, userId: string): Promise<Map<string, string>> {
  const rows = await database
    .select({ accountId: bankAccountLinks.accountId, aspspName: bankConnections.aspspName })
    .from(bankAccountLinks)
    .innerJoin(bankConnections, eq(bankConnections.id, bankAccountLinks.connectionId))
    .where(
      and(
        eq(bankAccountLinks.userId, userId),
        eq(bankConnections.userId, userId),
        eq(bankConnections.status, "active"),
        isNotNull(bankAccountLinks.accountId),
        isNotNull(bankAccountLinks.linkedAt),
      ),
    );
  return new Map(rows.flatMap((r) => (r.accountId ? [[r.accountId, r.aspspName] as const] : [])));
}

/** Newest transaction date per franC account, for the link step's default start date. */
export async function newestDateByAccount(database: Database, userId: string): Promise<Map<string, string>> {
  const rows = await database
    .select({ accountId: transactions.accountId, newest: max(transactions.date) })
    .from(transactions)
    // Rows added by hand are left out: this is the bank data's newest date.
    .where(and(eq(transactions.userId, userId), ne(transactions.source, "manual")))
    .groupBy(transactions.accountId);
  return new Map(rows.flatMap((r) => (r.newest ? [[r.accountId, r.newest] as const] : [])));
}

/** How many rows the latest sync run brought, per franC account. */
export async function lastSyncInsertedByAccount(database: Database, userId: string): Promise<Map<string, number>> {
  const rows = await database
    .select({ accountId: imports.accountId, inserted: imports.rowsInserted })
    .from(imports)
    .where(and(eq(imports.userId, userId), eq(imports.kind, "sync")))
    .orderBy(desc(imports.uploadedAt))
    .limit(200);
  const out = new Map<string, number>();
  for (const r of rows) if (!out.has(r.accountId)) out.set(r.accountId, r.inserted);
  return out;
}

/** franC account id → its link and bank name, for accounts a linked bank account feeds. */
export async function syncLinkByAccount(
  database: Database,
  userId: string,
): Promise<Map<string, { linkId: string; bankName: string }>> {
  const rows = await database
    .select({ accountId: bankAccountLinks.accountId, linkId: bankAccountLinks.id, bankName: bankConnections.aspspName })
    .from(bankAccountLinks)
    .innerJoin(bankConnections, eq(bankConnections.id, bankAccountLinks.connectionId))
    .where(
      and(
        eq(bankAccountLinks.userId, userId),
        eq(bankConnections.userId, userId),
        eq(bankConnections.status, "active"),
        isNotNull(bankAccountLinks.accountId),
        isNotNull(bankAccountLinks.linkedAt),
      ),
    );
  return new Map(rows.flatMap((r) => (r.accountId ? [[r.accountId, { linkId: r.linkId, bankName: r.bankName }] as const] : [])));
}
