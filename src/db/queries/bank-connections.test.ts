// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { accounts, bankAccountLinks, bankConnections, imports, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { createAccount, deleteAccount, listAccounts } from "./accounts";
import {
  bankConnectionStore,
  deleteBankConnection,
  linkedBankByAccount,
  listBankConnections,
  saveBankLinks,
} from "./bank-connections";
import { provisionUserDefaults } from "./provision";

const store = bankConnectionStore(db);
const UNTIL = new Date("2027-03-31T00:00:00Z");
const BANK_ACCOUNTS = [
  { bankAccountUid: "uid-1", displayName: "Compte de cheques", ibanLast4: "1234", currency: "EUR" },
  { bankAccountUid: "uid-2", displayName: "Livret A", ibanLast4: "5678", currency: "EUR" },
];

async function connected(userId: string, state = `st-${userId}`) {
  await store.createPending(userId, { aspspName: "Caisse d'Epargne", aspspCountry: "FR", authState: state, validUntil: UNTIL });
  const pending = await store.findPendingByState(userId, state);
  if (!pending) throw new Error("no pending");
  await store.activate(userId, pending.id, { sessionId: "sess", validUntil: UNTIL, connectedAt: new Date(), accounts: BANK_ACCOUNTS });
  const view = (await listBankConnections(db, userId)).find((c) => c.id === pending.id);
  if (!view) throw new Error("not listed");
  return view;
}

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [main] = await listAccounts(user.id);
  return { user, main };
}

beforeEach(resetDb);

describe("bank connections", () => {
  it("finds a pending connection only for its own user and only once", async () => {
    const { user } = await setup();
    const other = await createTestUser();
    await store.createPending(user.id, { aspspName: "B", aspspCountry: "FR", authState: "abc", validUntil: UNTIL });
    expect(await store.findPendingByState(other.id, "abc")).toBeNull();
    const pending = await store.findPendingByState(user.id, "abc");
    expect(pending).not.toBeNull();
    await store.activate(user.id, pending!.id, { sessionId: "s", validUntil: UNTIL, connectedAt: new Date(), accounts: [] });
    expect(await store.findPendingByState(user.id, "abc")).toBeNull();
    const [row] = await db.select().from(bankConnections).where(eq(bankConnections.id, pending!.id));
    expect(row).toMatchObject({ status: "active", authState: null, sessionId: "s" });
  });

  it("lists active connections with their unlinked bank accounts, hiding pending ones", async () => {
    const { user } = await setup();
    await store.createPending(user.id, { aspspName: "Pending", aspspCountry: "FR", authState: "p", validUntil: UNTIL });
    const view = await connected(user.id);
    expect((await listBankConnections(db, user.id)).map((c) => c.aspspName)).toEqual(["Caisse d'Epargne"]);
    expect(view.links.map((l) => [l.displayName, l.linked, l.accountId])).toEqual([
      ["Compte de cheques", false, null],
      ["Livret A", false, null],
    ]);
  });

  it("saves links to an existing and a new account in one go", async () => {
    const { user, main } = await setup();
    const view = await connected(user.id);
    const [cheques, livret] = view.links;
    const result = await saveBankLinks(db, user.id, view.id, [
      { linkId: cheques.id, choice: { kind: "existing", accountId: main.id } },
      { linkId: livret.id, choice: { kind: "new", name: "Livret A" } },
    ]);
    expect(result).toEqual({ ok: true });
    const [after] = await listBankConnections(db, user.id);
    expect(after.links.map((l) => [l.accountName, l.linked])).toEqual([
      [main.name, true],
      ["Livret A", true],
    ]);
    const linked = await linkedBankByAccount(db, user.id);
    expect(linked.get(main.id)).toBe("Caisse d'Epargne");
  });

  it("refuses another user's account and an account fed by another bank account", async () => {
    const { user, main } = await setup();
    const other = await setup();
    const view = await connected(user.id);
    const [cheques, livret] = view.links;
    expect(
      await saveBankLinks(db, user.id, view.id, [{ linkId: cheques.id, choice: { kind: "existing", accountId: other.main.id } }]),
    ).toEqual({ ok: false, error: "notFound" });
    await saveBankLinks(db, user.id, view.id, [{ linkId: cheques.id, choice: { kind: "existing", accountId: main.id } }]);
    expect(
      await saveBankLinks(db, user.id, view.id, [{ linkId: livret.id, choice: { kind: "existing", accountId: main.id } }]),
    ).toEqual({ ok: false, error: "accountTaken" });
    expect(await saveBankLinks(db, other.user.id, view.id, [{ linkId: livret.id, choice: { kind: "skip" } }])).toEqual({
      ok: false,
      error: "notFound",
    });
  });

  it("rolls back created accounts when a later choice fails", async () => {
    const { user, main } = await setup();
    const view = await connected(user.id);
    const [cheques] = view.links;
    const extra = await createAccount(db, user.id, "Joint");
    if (!extra.ok) throw new Error("setup");
    await saveBankLinks(db, user.id, view.id, [{ linkId: cheques.id, choice: { kind: "existing", accountId: extra.account.id } }]);
    // A second connection tries to create an account, then claim one the first connection feeds.
    const second = await connected(user.id, "st-2");
    const result = await saveBankLinks(db, user.id, second.id, [
      { linkId: second.links[0].id, choice: { kind: "new", name: "New one" } },
      { linkId: second.links[1].id, choice: { kind: "existing", accountId: extra.account.id } },
    ]);
    expect(result).toEqual({ ok: false, error: "accountTaken" });
    expect((await listAccounts(user.id)).map((a) => a.name).sort()).toEqual(["Joint", main.name].sort());
  });

  it("keeps the link but forgets the account when the account is deleted", async () => {
    const { user } = await setup();
    const extra = await createAccount(db, user.id, "Joint");
    if (!extra.ok) throw new Error("setup");
    const view = await connected(user.id);
    await saveBankLinks(db, user.id, view.id, [{ linkId: view.links[0].id, choice: { kind: "existing", accountId: extra.account.id } }]);
    await deleteAccount(db, user.id, extra.account.id);
    const [after] = await listBankConnections(db, user.id);
    expect(after.links[0]).toMatchObject({ accountId: null });
  });

  it("disconnecting deletes the connection and links but keeps accounts and transactions", async () => {
    const { user, main } = await setup();
    const view = await connected(user.id);
    await saveBankLinks(db, user.id, view.id, [{ linkId: view.links[0].id, choice: { kind: "existing", accountId: main.id } }]);
    const [imp] = await db.insert(imports).values({ userId: user.id, accountId: main.id, filename: "x.csv" }).returning();
    await db.insert(transactions).values({
      userId: user.id,
      accountId: main.id,
      importId: imp.id,
      date: "2026-09-01",
      amountCents: -100,
      labelRaw: "L",
      labelNormalized: "L",
      labelDisplay: "L",
      dedupeHash: "h",
      occurrenceIndex: 0,
    });

    const other = await createTestUser();
    expect(await deleteBankConnection(db, other.id, view.id)).toBeNull();
    expect(await deleteBankConnection(db, user.id, view.id)).toEqual({ sessionId: "sess" });

    expect(await listBankConnections(db, user.id)).toEqual([]);
    expect(await db.select().from(bankAccountLinks)).toEqual([]);
    expect(await db.select().from(accounts).where(eq(accounts.userId, user.id))).toHaveLength(1);
    expect(await db.select().from(transactions).where(eq(transactions.userId, user.id))).toHaveLength(1);
  });
});
