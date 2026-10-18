// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { runBankHealthPush, type SendPush } from "@/lib/push/run-reminders";

import { db } from "../client";
import { accounts, balanceCheckpoints, bankAccountLinks, bankConnections, imports, transactionMatches, transactions, users } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { listAccounts } from "./accounts";
import { bankConnectionStore, hasConnectedAccount, listBankConnections, saveBankLinks } from "./bank-connections";
import { listDailySyncTargets, listSyncableLinks, recordAttempt } from "./bank-sync";
import { getAccountFreshness } from "./import-reminder";
import { provisionUserDefaults } from "./provision";
import { savePushSubscription } from "./push";

const store = bankConnectionStore(db);
const NOW = new Date("2026-10-05T07:00:00Z");
const UNTIL = new Date("2027-03-31T00:00:00Z");
const acct = (uid: string, name: string, extra: { identificationHash?: string; ibanLast4?: string } = {}) => ({
  bankAccountUid: uid,
  displayName: name,
  ibanLast4: extra.ibanLast4 ?? "1234",
  currency: "EUR",
  identificationHash: extra.identificationHash ?? null,
});

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [main] = await listAccounts(user.id);
  return { user, main };
}

/** An active connection, optionally the Reconnect of `replaces`. Returns the activate result. */
async function connect(userId: string, accountsIn: ReturnType<typeof acct>[], opts: { replaces?: string; validUntil?: Date; session?: string } = {}) {
  const state = `st-${Math.random()}`;
  await store.createPending(userId, {
    aspspName: "Caisse d'Epargne",
    aspspCountry: "FR",
    authState: state,
    validUntil: UNTIL,
    ...(opts.replaces ? { replacesConnectionId: opts.replaces } : {}),
  });
  const pending = await store.findPendingByState(userId, state);
  const result = await store.activate(userId, pending!.id, {
    sessionId: opts.session ?? "sess",
    validUntil: opts.validUntil ?? UNTIL,
    connectedAt: NOW,
    accounts: accountsIn,
  });
  return { id: pending!.id, result };
}

async function linked(userId: string, accountIds: Array<string | null>, accountsIn = [acct("u1", "Compte"), acct("u2", "Livret", { ibanLast4: "5678" })]) {
  const { id } = await connect(userId, accountsIn);
  const view = (await listBankConnections(db, userId)).find((c) => c.id === id)!;
  await saveBankLinks(
    db,
    userId,
    id,
    view.links.map((l, i) => ({ linkId: l.id, choice: accountIds[i] ? { kind: "existing" as const, accountId: accountIds[i]! } : { kind: "skip" as const } })),
  );
  return { id, view: (await listBankConnections(db, userId)).find((c) => c.id === id)! };
}

beforeEach(resetDb);

describe("recordAttempt", () => {
  it("clears the error on success and keeps failing_since while failures continue", async () => {
    const { user, main } = await setup();
    const { view } = await linked(user.id, [main.id, null]);
    const linkId = view.links.find((l) => l.imported)!.id;
    const read = async () => (await db.select().from(bankAccountLinks).where(eq(bankAccountLinks.id, linkId)))[0];

    const t1 = new Date("2026-10-03T07:00:00Z");
    await recordAttempt(db, user.id, linkId, { at: t1, error: "bank_unavailable" });
    expect(await read()).toMatchObject({ lastAttemptAt: t1, lastError: "bank_unavailable", failingSince: t1 });

    const t2 = new Date("2026-10-04T07:00:00Z");
    await recordAttempt(db, user.id, linkId, { at: t2, error: "network" });
    expect(await read()).toMatchObject({ lastAttemptAt: t2, lastError: "network", failingSince: t1 });

    await recordAttempt(db, user.id, linkId, { at: NOW, error: null });
    expect(await read()).toMatchObject({ lastAttemptAt: NOW, lastError: null, failingSince: null });
  });

  it("does not start a run of failures on a rate limit, and does not end one", async () => {
    const { user, main } = await setup();
    const { view } = await linked(user.id, [main.id, null]);
    const linkId = view.links.find((l) => l.imported)!.id;
    await recordAttempt(db, user.id, linkId, { at: NOW, error: "rate_limited" });
    const [row] = await db.select().from(bankAccountLinks).where(eq(bankAccountLinks.id, linkId));
    expect(row).toMatchObject({ lastError: "rate_limited", failingSince: null });

    const t1 = new Date("2026-10-06T07:00:00Z");
    await recordAttempt(db, user.id, linkId, { at: t1, error: "network" });
    await recordAttempt(db, user.id, linkId, { at: new Date("2026-10-07T07:00:00Z"), error: "rate_limited" });
    const [after] = await db.select().from(bankAccountLinks).where(eq(bankAccountLinks.id, linkId));
    expect(after.failingSince).toEqual(t1);
  });

  it("ignores another user's link", async () => {
    const { user, main } = await setup();
    const other = await createTestUser();
    const { view } = await linked(user.id, [main.id, null]);
    const linkId = view.links[0].id;
    await recordAttempt(db, other.id, linkId, { at: NOW, error: "network" });
    const [row] = await db.select().from(bankAccountLinks).where(eq(bankAccountLinks.id, linkId));
    expect(row.lastAttemptAt).toBeNull();
  });

  it("feeds the connection health in the list", async () => {
    const { user, main } = await setup();
    const { view } = await linked(user.id, [main.id, null]);
    expect(view.health.kind).toBe("never");
    await recordAttempt(db, user.id, view.links[0].id, { at: NOW, error: "unauthorized" });
    const [after] = await listBankConnections(db, user.id, NOW);
    expect(after.health.kind).toBe("reconnect");
    expect(after.links[0]).toMatchObject({ lastError: "unauthorized", imported: true });
  });
});

describe("sync targets", () => {
  it("lists imported links of active, unexpired connections only, per user", async () => {
    const { user, main } = await setup();
    const { user: other, main: otherMain } = await setup();
    await linked(user.id, [main.id, null]);
    const { id: expiredId } = await linked(other.id, [otherMain.id, null]);
    await db.update(bankConnections).set({ validUntil: new Date("2026-10-01T00:00:00Z") }).where(eq(bankConnections.id, expiredId));

    expect(await listSyncableLinks(db, user.id)).toHaveLength(1);
    const targets = await listDailySyncTargets(db, NOW);
    expect(targets.map((t) => t.userId)).toEqual([user.id]);
    expect(targets[0].email).toBe(user.email);
  });
});

describe("hasConnectedAccount", () => {
  it("a pending connection doesn't count", async () => {
    const { user, main } = await setup();
    await db.insert(accounts).values({ userId: user.id, name: "Savings" });
    expect(await hasConnectedAccount(db, user.id)).toBe(false);

    await linked(user.id, [main.id, null]);
    expect(await hasConnectedAccount(db, user.id)).toBe(true);
  });

  it("still counts an expired connection as connected, and is scoped by user", async () => {
    const { user, main } = await setup();
    const other = await createTestUser();
    const { id } = await linked(user.id, [main.id, null]);
    await db.update(bankConnections).set({ status: "expired" }).where(eq(bankConnections.id, id));
    expect(await hasConnectedAccount(db, user.id)).toBe(true);
    expect(await hasConnectedAccount(db, other.id)).toBe(false);
  });
});

describe("import reminder filter", () => {
  it("only watches accounts without a bank link when asked", async () => {
    const { user, main } = await setup();
    const [savings] = await db.insert(accounts).values({ userId: user.id, name: "Savings" }).returning();
    await linked(user.id, [main.id, null]);
    expect((await getAccountFreshness(db, user.id)).map((a) => a.accountId).sort()).toEqual([main.id, savings.id].sort());
    expect((await getAccountFreshness(db, user.id, { withoutBankLink: true })).map((a) => a.accountId)).toEqual([savings.id]);
  });
});

describe("reconnect", () => {
  async function seedHistory(userId: string, accountId: string) {
    const [imp] = await db.insert(imports).values({ userId, accountId, filename: "x", rowsTotal: 1, rowsError: 0 }).returning();
    const [tx] = await db
      .insert(transactions)
      .values({ userId, accountId, importId: imp.id, date: "2026-10-01", amountCents: -500, labelRaw: "L", labelNormalized: "L", labelDisplay: "L", dedupeHash: "h", occurrenceIndex: 0 })
      .returning();
    await db.insert(transactionMatches).values({ userId, accountId, transactionId: tx.id, importId: imp.id, source: "csv", dedupeHash: "h2", occurrenceIndex: 0 });
    await db.insert(balanceCheckpoints).values({ userId, accountId, date: "2026-10-01", amountCents: 1000, source: "bank", bankName: "B", fetchedAt: NOW, balanceType: "CLBD" });
  }

  it("moves the links to the new connection in one go and keeps transactions, matches and checkpoints", async () => {
    const { user, main } = await setup();
    const [savings] = await db.insert(accounts).values({ userId: user.id, name: "Savings" }).returning();
    const { id: oldId } = await linked(user.id, [main.id, savings.id], [acct("u1", "Compte", { identificationHash: "h1" }), acct("u2", "Livret", { ibanLast4: "5678" })]);
    await db
      .update(bankAccountLinks)
      .set({ syncFrom: "2026-09-10", lastSyncedAt: new Date("2026-10-04T07:00:00Z") })
      .where(eq(bankAccountLinks.connectionId, oldId));
    await seedHistory(user.id, main.id);

    // New session: different uids; the first matches by hash, the second by IBAN end and name.
    const { id: newId, result } = await connect(
      user.id,
      [acct("n1", "Autre nom", { identificationHash: "h1" }), acct("n2", "Livret", { ibanLast4: "5678" })],
      { replaces: oldId, session: "new-sess" },
    );
    expect(result).toEqual({ reconnected: true, replacedSessionId: "sess" });

    expect(await db.select().from(bankConnections).where(eq(bankConnections.id, oldId))).toHaveLength(0);
    const links = await db.select().from(bankAccountLinks).where(eq(bankAccountLinks.connectionId, newId));
    expect(links.map((l) => l.accountId).sort()).toEqual([main.id, savings.id].sort());
    for (const l of links) {
      expect(l.linkedAt).not.toBeNull();
      expect(l.syncFrom).toBe("2026-09-10");
      expect(l.lastSyncedAt).toEqual(new Date("2026-10-04T07:00:00Z"));
    }
    const [conn] = await db.select().from(bankConnections).where(eq(bankConnections.id, newId));
    expect(conn).toMatchObject({ status: "active", replacesConnectionId: null });

    expect(await db.select().from(transactions).where(eq(transactions.accountId, main.id))).toHaveLength(1);
    expect(await db.select().from(transactionMatches).where(eq(transactionMatches.accountId, main.id))).toHaveLength(1);
    expect(await db.select().from(balanceCheckpoints).where(eq(balanceCheckpoints.accountId, main.id))).toHaveLength(1);
    expect((await listBankConnections(db, user.id))[0].links.every((l) => l.linked)).toBe(true);
  });

  it("links an extra new account without a franC account when every old one was found", async () => {
    const { user, main } = await setup();
    const { id: oldId } = await linked(user.id, [main.id, null], [acct("u1", "Compte"), acct("u2", "Livret", { ibanLast4: "5678" })]);
    const { id: newId } = await connect(user.id, [acct("u1", "Compte"), acct("u2", "Livret", { ibanLast4: "5678" }), acct("u3", "PEL", { ibanLast4: "9999" })], { replaces: oldId });
    const links = await db.select().from(bankAccountLinks).where(eq(bankAccountLinks.connectionId, newId));
    expect(links).toHaveLength(3);
    expect(links.every((l) => l.linkedAt !== null)).toBe(true);
    expect(links.find((l) => l.bankAccountUid === "u3")!.accountId).toBeNull();
  });

  it("leaves the unmatched new accounts to the link form when an imported one wasn't found", async () => {
    const { user, main } = await setup();
    const { id: oldId } = await linked(user.id, [main.id, null], [acct("u1", "Compte"), acct("u2", "Livret", { ibanLast4: "5678" })]);
    const { id: newId } = await connect(user.id, [acct("zz", "Something else", { ibanLast4: "0000" })], { replaces: oldId });
    const [link] = await db.select().from(bankAccountLinks).where(eq(bankAccountLinks.connectionId, newId));
    expect(link).toMatchObject({ accountId: null, linkedAt: null });
    // The old connection is gone, so the franC account is free for the form to offer.
    expect(await db.select().from(bankConnections).where(eq(bankConnections.id, oldId))).toHaveLength(0);
    const [view] = await listBankConnections(db, user.id);
    expect(view.links.some((l) => !l.linked)).toBe(true);
  });

  it("refuses another user's connection id, and a pending one", async () => {
    const { user } = await setup();
    const { user: other, main: otherMain } = await setup();
    const { id: theirs } = await linked(other.id, [otherMain.id, null]);
    expect(await store.ownsConnection(user.id, theirs)).toBe(false);
    expect(await store.ownsConnection(other.id, theirs)).toBe(true);

    await store.createPending(user.id, { aspspName: "B", aspspCountry: "FR", authState: "p", validUntil: UNTIL });
    const [pending] = await db.select().from(bankConnections).where(eq(bankConnections.authState, "p"));
    expect(await store.ownsConnection(user.id, pending.id)).toBe(false);
  });

  it("does not touch a connection of another user even if its id is on the pending row", async () => {
    const { user } = await setup();
    const { user: other, main: otherMain } = await setup();
    const { id: theirs } = await linked(other.id, [otherMain.id, null]);
    const { result } = await connect(user.id, [acct("u1", "Compte")], { replaces: theirs });
    expect(result.reconnected).toBe(false);
    expect(await db.select().from(bankConnections).where(eq(bankConnections.id, theirs))).toHaveLength(1);
  });
});

describe("runBankHealthPush", () => {
  const TODAY = "2026-10-05";
  const RUN = new Date("2026-10-05T07:00:00Z");
  const sub = (endpoint: string) => ({ endpoint, p256dh: "p", auth: "a" });

  function sender() {
    const calls: Array<{ title: string; body: string; url: string }> = [];
    const send: SendPush = async (_s, payload) => {
      calls.push(payload);
      return { ok: true };
    };
    return { send, calls };
  }
  const run = (send: SendPush, allowed = true) =>
    runBankHealthPush({ database: db, send, isAllowed: () => allowed, today: TODAY, runStartedAt: RUN });

  async function failingUser(since: Date, validUntil = UNTIL) {
    const { user, main } = await setup();
    const { id, view } = await linked(user.id, [main.id, null]);
    await db.update(bankConnections).set({ validUntil }).where(eq(bankConnections.id, id));
    await recordAttempt(db, user.id, view.links[0].id, { at: since, error: "network" });
    await savePushSubscription(db, user.id, sub(`https://push.test/${user.id}`));
    return user;
  }

  it("waits for the second failed morning, then sends a generic message once a week", async () => {
    const first = await failingUser(new Date("2026-10-05T07:00:05Z"));
    const { send, calls } = sender();
    expect((await run(send)).sent).toBe(0);

    await recordAttempt(db, first.id, (await listBankConnections(db, first.id))[0].links[0].id, { at: new Date("2026-10-04T07:00:00Z"), error: null });
    await db.update(bankAccountLinks).set({ failingSince: new Date("2026-10-04T07:00:03Z"), lastError: "network" }).where(eq(bankAccountLinks.userId, first.id));
    expect((await run(send)).sent).toBe(1);
    expect(calls[0]).toEqual({ title: "Bank sync is failing", body: "franC couldn't sync your bank since 4 Oct. Open franC to check.", url: "/accounts/bank" });
    expect(JSON.stringify(calls)).not.toContain("Caisse");
    const [row] = await db.select().from(users).where(eq(users.id, first.id));
    expect(row.bankHealthNotifiedOn).toBe(TODAY);

    expect((await run(send)).sent).toBe(0);
  });

  it("sends the reconnect message at once when the consent ends soon, and skips users not allowed", async () => {
    const user = await failingUser(new Date("2026-10-05T07:00:05Z"), new Date("2026-10-10T00:00:00Z"));
    const { send, calls } = sender();
    expect((await run(send, false)).sent).toBe(0);
    expect((await run(send)).sent).toBe(1);
    expect(calls[0].title).toBe("Reconnect your bank");
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.bankHealthNotifiedOn).toBe(TODAY);
  });

  it("sends nothing for a healthy connection or without a subscribed device", async () => {
    const { user, main } = await setup();
    await linked(user.id, [main.id, null]);
    const { send } = sender();
    expect((await run(send)).sent).toBe(0);
    const { user: u2, main: m2 } = await setup();
    const { id } = await linked(u2.id, [m2.id, null]);
    await db.update(bankConnections).set({ validUntil: new Date("2026-10-08T00:00:00Z") }).where(eq(bankConnections.id, id));
    expect((await run(send)).sent).toBe(0);
  });
});
