// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { EnableBankingClient } from "../../lib/bank-sync/client";
import type { BankBalance, BankTransaction } from "../../lib/bank-sync/schemas";
import { syncAccount } from "../../lib/bank-sync/sync";
import { prepareImport } from "../../lib/import";
import { db } from "../client";
import { bankAccountLinks, duplicateCandidates, imports, transactionMatches, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { listAccounts } from "./accounts";
import { bankConnectionStore, listBankConnections, saveBankLinks } from "./bank-connections";
import { bankSyncStore } from "./bank-sync";
import { createRule } from "./category-rules";
import { createCategory } from "./categories";
import { getSplit, saveSplit } from "./splits";
import { addTagsToTransaction, loadTransactionTags, setTransactionNote } from "./tags";
import { setTransactionCategory } from "./transactions";
import { commitImport, listImports, planMatches, undoImport } from "./imports";
import { provisionUserDefaults } from "./provision";

const NOW = new Date("2026-10-02T10:00:00Z");
const UNTIL = new Date("2027-03-31T00:00:00Z");
const store = bankSyncStore(db);
const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

const bakery = (over: Partial<BankTransaction> = {}): BankTransaction => ({
  entry_reference: "E-BAKERY",
  transaction_amount: { amount: "5.88", currency: "EUR" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2026-09-30",
  remittance_information: ["CB BOULANGERIE DES L FACT 290926 4000XXXX1234"],
  ...over,
});

function client(transactions: BankTransaction[], balances: BankBalance[] = []): EnableBankingClient {
  return { getTransactions: async () => transactions, getBalances: async () => balances } as unknown as EnableBankingClient;
}

/** A user whose main account is fed by a linked bank account; returns the link id. */
async function linked() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [main] = await listAccounts(user.id);
  const connections = bankConnectionStore(db);
  await connections.createPending(user.id, { aspspName: "Caisse d'Epargne", aspspCountry: "FR", authState: `s-${user.id}`, validUntil: UNTIL });
  const pending = await connections.findPendingByState(user.id, `s-${user.id}`);
  await connections.activate(user.id, pending!.id, {
    sessionId: "sess",
    validUntil: UNTIL,
    connectedAt: NOW,
    accounts: [{ bankAccountUid: "uid-1", displayName: "Compte de cheques", ibanLast4: "1234", currency: "EUR" }],
  });
  const [connection] = await listBankConnections(db, user.id);
  const [link] = connection.links;
  await saveBankLinks(db, user.id, connection.id, [{ linkId: link.id, choice: { kind: "existing", accountId: main.id } }]);
  return { user, main, linkId: link.id };
}

async function importCsv(userId: string, accountId: string, lines: string[]) {
  const prepared = prepareImport([HEADER, ...lines].join("\n"), accountId);
  if (!prepared.ok) throw new Error(prepared.fileError);
  return commitImport(db, { userId, accountId, filename: "x.csv", rowsTotal: prepared.rowsTotal, rowsError: 0, transactions: prepared.transactions });
}

const sync = (userId: string, linkId: string, rows: BankTransaction[], now = NOW, balances: BankBalance[] = []) =>
  syncAccount({ client: client(rows, balances), store, now }, userId, linkId);

beforeEach(resetDb);

describe("bank sync store", () => {
  it("stores synced rows with their source, id and short label, to review, under a sync run", async () => {
    const { user, main, linkId } = await linked();
    const category = await createCategory(db, user.id, { name: "Food", color: "#336699" });
    if (!category.ok) throw new Error("category");
    await createRule(db, user.id, { pattern: "BOULANGERIE", matchType: "contains", categoryId: category.category.id });

    const result = await sync(user.id, linkId, [bakery()]);
    expect(result).toMatchObject({ ok: true, inserted: 1, duplicate: 0, errors: 0 });
    const [row] = await db.select().from(transactions).where(eq(transactions.accountId, main.id));
    expect(row).toMatchObject({
      date: "2026-09-29",
      amountCents: -588,
      labelRaw: "CB BOULANGERIE DES L FACT 290926",
      labelDisplay: "BOULANGERIE DES L",
      source: "sync",
      externalId: "E-BAKERY",
      categoryId: category.category.id,
      categorySource: "rule",
      reviewedAt: null,
    });
    const [run] = await listImports(db, user.id);
    expect(run).toMatchObject({ kind: "sync", filename: "Caisse d'Epargne", rowsInserted: 1 });
    const [saved] = await db.select().from(bankAccountLinks).where(eq(bankAccountLinks.id, linkId));
    expect(saved.lastSyncedAt).toEqual(NOW);
    expect(saved.syncFrom).toBe("2026-07-05");
  });

  it("syncing the same response again inserts nothing but still records the run", async () => {
    const { user, linkId } = await linked();
    await sync(user.id, linkId, [bakery()]);
    const again = await sync(user.id, linkId, [bakery()], new Date("2026-10-02T11:00:00Z"));
    expect(again).toMatchObject({ ok: true, inserted: 0, duplicate: 1 });
    expect(await listImports(db, user.id)).toHaveLength(2);
  });

  it("a row the user ignored does not come back on the next sync", async () => {
    const { user, main, linkId } = await linked();
    await sync(user.id, linkId, [bakery()]);
    await db.update(transactions).set({ ignoredAt: NOW }).where(eq(transactions.accountId, main.id));
    expect(await sync(user.id, linkId, [bakery()], new Date("2026-10-02T11:00:00Z"))).toMatchObject({ ok: true, inserted: 0, duplicate: 1 });
    const rows = await db.select().from(transactions).where(eq(transactions.accountId, main.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].ignoredAt).not.toBeNull();
  });

  it("the same bank id with a changed label is still one row", async () => {
    const { user, main, linkId } = await linked();
    await sync(user.id, linkId, [bakery()]);
    await sync(user.id, linkId, [bakery({ remittance_information: ["CB BOULANGERIE DES LILAS FACT 290926 X1"] })]);
    expect(await db.select().from(transactions).where(eq(transactions.accountId, main.id))).toHaveLength(1);
  });

  it("a row already imported from the CSV has the same hash and is skipped", async () => {
    const { user, main, linkId } = await linked();
    await importCsv(user.id, main.id, [
      "30/09/2026;BOULANGERIE DES LILAS;CB BOULANGERIE DES L FACT 290926;R1;;Carte;;;-5,88;;29/09/2026;30/09/2026;0",
    ]);
    await db.update(bankAccountLinks).set({ syncFrom: "2026-09-01" }).where(eq(bankAccountLinks.id, linkId));
    const result = await sync(user.id, linkId, [bakery()]);
    expect(result).toMatchObject({ ok: true, inserted: 0, duplicate: 1 });
    // And the CSV taught the short label: a new bakery payment gets the full name.
    await sync(user.id, linkId, [bakery({ entry_reference: "E2", booking_date: "2026-10-01", remittance_information: ["CB BOULANGERIE DES L FACT 300926 X1"] })]);
    const rows = await db.select().from(transactions).where(eq(transactions.accountId, main.id));
    expect(rows.map((r) => [r.source, r.labelDisplay]).sort()).toEqual([
      ["csv", "BOULANGERIE DES LILAS"],
      ["sync", "BOULANGERIE DES LILAS"],
    ]);
  });

  describe("manual and automatic together", () => {
    const csvLine = (date: string, label: string, amount = "-5,88", ref = "R1") =>
      `${date};${label};${label} OPERATION;${ref};;Carte;;;${amount};;${date};${date};0`;
    const matchesOf = (accountId: string) =>
      db.select().from(transactionMatches).where(eq(transactionMatches.accountId, accountId));
    const rowsOf = (accountId: string) => db.select().from(transactions).where(eq(transactions.accountId, accountId));

    it("a CSV row, then the same purchase synced under another label and date: one row that keeps everything", async () => {
      const { user, main, linkId } = await linked();
      const imported = await importCsv(user.id, main.id, [csvLine("30/09/2026", "PAIN AU LEVAIN")]);
      const [kept] = await rowsOf(main.id);
      const food = await createCategory(db, user.id, { name: "Food", color: "#336699" });
      const treats = await createCategory(db, user.id, { name: "Treats", color: "#663399" });
      if (!food.ok || !treats.ok) throw new Error("category");
      await setTransactionCategory(db, user.id, kept.id, food.category.id);
      await setTransactionNote(db, user.id, kept.id, "birthday cake");
      expect((await addTagsToTransaction(db, user.id, kept.id, ["party"])).ok).toBe(true);
      expect(
        (await saveSplit(db, user.id, kept.id, [
          { categoryId: food.category.id, amountCents: -300 },
          { categoryId: treats.category.id, amountCents: -288 },
        ])).ok,
      ).toBe(true);

      // The bakery row is dated 29 Sept: one day before the CSV row, other label, so another hash.
      const result = await sync(user.id, linkId, [bakery()]);
      expect(result).toMatchObject({ ok: true, inserted: 0, duplicate: 1, possible: 0 });

      const rows = await rowsOf(main.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: kept.id,
        source: "csv",
        date: "2026-09-30",
        categoryId: food.category.id,
        note: "birthday cake",
        labelRaw: kept.labelRaw,
      });
      expect((await loadTransactionTags(db, user.id, [kept.id])).get(kept.id)?.map((t) => t.name)).toEqual(["party"]);
      expect((await getSplit(db, user.id, kept.id))?.parts).toHaveLength(2);
      const [match] = await matchesOf(main.id);
      expect(match).toMatchObject({ transactionId: kept.id, source: "sync", externalId: "E-BAKERY" });
      expect(match.importId).not.toBe(imported.import.id);
      const [run] = await listImports(db, user.id);
      expect(run).toMatchObject({ kind: "sync", rowsInserted: 0, rowsDuplicate: 1 });

      // Neither a new sync nor a new import of the same file brings anything back.
      expect(await sync(user.id, linkId, [bakery()])).toMatchObject({ ok: true, inserted: 0, duplicate: 1 });
      const again = await importCsv(user.id, main.id, [csvLine("30/09/2026", "PAIN AU LEVAIN")]);
      expect(again.import).toMatchObject({ rowsInserted: 0, rowsDuplicate: 1 });
      expect(await rowsOf(main.id)).toHaveLength(1);
      expect(await matchesOf(main.id)).toHaveLength(1);
    });

    it("a synced row, then the CSV of the same purchase: one row, in the preview and in the import", async () => {
      const { user, main, linkId } = await linked();
      await sync(user.id, linkId, [bakery()]);
      const prepared = prepareImport([HEADER, csvLine("30/09/2026", "PAIN AU LEVAIN")].join("\n"), main.id);
      if (!prepared.ok) throw new Error(prepared.fileError);

      const preview = await planMatches(db, user.id, main.id, "csv", prepared.transactions);
      expect(preview.counts).toEqual({ insert: 0, duplicate: 0, merge: 1, possible: 0, adopt: 0 });

      const imported = await importCsv(user.id, main.id, [csvLine("30/09/2026", "PAIN AU LEVAIN")]);
      expect(imported).toMatchObject({ rowsMerged: 1, rowsPossible: 0 });
      expect(imported.import).toMatchObject({ rowsInserted: 0, rowsDuplicate: 1 });
      const rows = await rowsOf(main.id);
      expect(rows.map((r) => r.source)).toEqual(["sync"]);
      expect((await matchesOf(main.id)).map((m) => m.source)).toEqual(["csv"]);

      // Previewing and importing again: now an exact duplicate through the merged identity.
      const second = await planMatches(db, user.id, main.id, "csv", prepared.transactions);
      expect(second.counts).toEqual({ insert: 0, duplicate: 1, merge: 0, possible: 0, adopt: 0 });
      expect((await importCsv(user.id, main.id, [csvLine("30/09/2026", "PAIN AU LEVAIN")])).import.rowsInserted).toBe(0);
      expect(await rowsOf(main.id)).toHaveLength(1);
    });

    it("undoing the CSV import forgets its merges and keeps the synced row", async () => {
      const { user, main, linkId } = await linked();
      await sync(user.id, linkId, [bakery()]);
      const imported = await importCsv(user.id, main.id, [csvLine("30/09/2026", "PAIN AU LEVAIN")]);
      expect(await matchesOf(main.id)).toHaveLength(1);
      expect(await undoImport(db, user.id, imported.import.id)).toEqual({ deleted: 0 });
      expect(await matchesOf(main.id)).toHaveLength(0);
      expect(await rowsOf(main.id)).toHaveLength(1);
    });

    it("two CSV candidates make the synced row a possible duplicate, linked to both", async () => {
      const { user, main, linkId } = await linked();
      await importCsv(user.id, main.id, [
        csvLine("27/09/2026", "PAIN UN", "-5,88", "R1"),
        csvLine("01/10/2026", "PAIN DEUX", "-5,88", "R2"),
      ]);
      const csvRows = await rowsOf(main.id);
      const result = await sync(user.id, linkId, [bakery()]);
      expect(result).toMatchObject({ ok: true, inserted: 1, duplicate: 0, possible: 1 });

      const synced = (await rowsOf(main.id)).find((r) => r.source === "sync");
      if (!synced) throw new Error("no synced row");
      expect(synced.reviewedAt).toBeNull();
      const links = await db.select().from(duplicateCandidates).where(eq(duplicateCandidates.transactionId, synced.id));
      expect(links.map((l) => l.candidateId).sort()).toEqual(csvRows.map((r) => r.id).sort());
      expect(await matchesOf(main.id)).toHaveLength(0);

      // The same bank row again is an exact duplicate: no second row, no new links.
      expect(await sync(user.id, linkId, [bakery()])).toMatchObject({ ok: true, inserted: 0, duplicate: 1 });
      expect(await db.select().from(duplicateCandidates)).toHaveLength(2);
    });

    it("with several candidates, the one on the same date wins", async () => {
      const { user, main, linkId } = await linked();
      await importCsv(user.id, main.id, [
        csvLine("28/09/2026", "PAIN UN", "-5,88", "R1"),
        csvLine("29/09/2026", "PAIN DEUX", "-5,88", "R2"),
      ]);
      const sameDay = (await rowsOf(main.id)).find((r) => r.date === "2026-09-29");
      const result = await sync(user.id, linkId, [bakery()]);
      expect(result).toMatchObject({ ok: true, inserted: 0, duplicate: 1, possible: 0 });
      expect((await matchesOf(main.id)).map((m) => m.transactionId)).toEqual([sameDay?.id]);
      expect(await db.select().from(duplicateCandidates)).toHaveLength(0);
    });

    it("each CSV row absorbs one synced row: two CSV rows, three synced, the last is new", async () => {
      const { user, main, linkId } = await linked();
      await importCsv(user.id, main.id, [
        csvLine("28/09/2026", "PAIN UN", "-5,88", "R1"),
        csvLine("30/09/2026", "PAIN DEUX", "-5,88", "R2"),
      ]);
      const synced = (id: string, day: string) =>
        bakery({ entry_reference: id, remittance_information: [`CB BOULANGERIE ${id} FACT ${day}0926 4000XXXX1234`] });
      // Matched by date order: 28 takes the 28 row, 29 takes the only one left, 30 finds none.
      const result = await sync(user.id, linkId, [synced("C", "30"), synced("B", "29"), synced("A", "28")]);
      expect(result).toMatchObject({ ok: true, inserted: 1, duplicate: 2, possible: 0 });
      expect(await matchesOf(main.id)).toHaveLength(2);
      expect((await rowsOf(main.id)).filter((r) => r.source === "sync").map((r) => r.externalId)).toEqual(["C"]);
    });

    it("another user's rows are never candidates", async () => {
      const { user, linkId } = await linked();
      const other = await createTestUser();
      await provisionUserDefaults(db, other.id);
      const [theirs] = await listAccounts(other.id);
      await importCsv(other.id, theirs.id, [csvLine("29/09/2026", "PAIN AU LEVAIN")]);
      const result = await sync(user.id, linkId, [bakery()]);
      expect(result).toMatchObject({ ok: true, inserted: 1, duplicate: 0, possible: 0 });
      expect(await db.select().from(transactionMatches)).toHaveLength(0);
    });

    it("a row ignored in the past still absorbs the incoming duplicate", async () => {
      const { user, main, linkId } = await linked();
      await importCsv(user.id, main.id, [csvLine("29/09/2026", "PAIN AU LEVAIN")]);
      await db.update(transactions).set({ ignoredAt: NOW }).where(eq(transactions.accountId, main.id));
      expect(await sync(user.id, linkId, [bakery()])).toMatchObject({ ok: true, inserted: 0, duplicate: 1 });
      expect(await rowsOf(main.id)).toHaveLength(1);
    });
  });

  it("refuses another user's link", async () => {
    const { linkId } = await linked();
    const other = await createTestUser();
    expect(await sync(other.id, linkId, [bakery()])).toEqual({ ok: false, error: "linkNotFound" });
  });

  it("sync runs can't be undone", async () => {
    const { user, linkId } = await linked();
    const result = await sync(user.id, linkId, [bakery()]);
    if (!result.ok) throw new Error(result.error);
    expect(await undoImport(db, user.id, result.importId)).toBeNull();
    expect(await db.select().from(imports).where(eq(imports.id, result.importId))).toHaveLength(1);
  });
});
