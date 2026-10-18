// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { EnableBankingClient } from "../../lib/bank-sync/client";
import type { BankTransaction } from "../../lib/bank-sync/schemas";
import { syncAccount } from "../../lib/bank-sync/sync";
import { prepareImport } from "../../lib/import";
import { db } from "../client";
import { duplicateCandidates, transactionMatches, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { listAccounts } from "./accounts";
import { bankConnectionStore, listBankConnections, saveBankLinks } from "./bank-connections";
import { bankSyncStore } from "./bank-sync";
import { createCategory } from "./categories";
import { keepBoth, mergeDuplicate } from "./duplicates";
import { commitImport } from "./imports";
import { provisionUserDefaults } from "./provision";
import { listReviewQueue } from "./review";
import { addTagsToTransaction, loadTransactionTags, setTransactionNote } from "./tags";
import { setTransactionCategory } from "./transactions";

const NOW = new Date("2026-10-02T10:00:00Z");
const UNTIL = new Date("2027-03-31T00:00:00Z");
const store = bankSyncStore(db);
const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

const bakery = (): BankTransaction => ({
  entry_reference: "E-BAKERY",
  transaction_amount: { amount: "5.88", currency: "EUR" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2026-09-30",
  remittance_information: ["CB BOULANGERIE DES L FACT 290926 4000XXXX1234"],
});

const client = (rows: BankTransaction[]) => ({ getTransactions: async () => rows, getBalances: async () => [] }) as unknown as EnableBankingClient;
const sync = (userId: string, linkId: string) => syncAccount({ client: client([bakery()]), store, now: NOW }, userId, linkId);
const csvLine = (date: string, label: string, ref: string) =>
  `${date};${label};${label} OPERATION;${ref};;Carte;;;-5,88;;${date};${date};0`;

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
  await saveBankLinks(db, user.id, connection.id, [{ linkId: connection.links[0].id, choice: { kind: "existing", accountId: main.id } }]);
  return { user, main, linkId: connection.links[0].id };
}

/** Two CSV rows around the bank's bakery row: the synced row becomes a possible duplicate of both. */
async function possible() {
  const ctx = await linked();
  const prepared = prepareImport([HEADER, csvLine("28/09/2026", "PAIN UN", "R1"), csvLine("02/10/2026", "PAIN DEUX", "R2")].join("\n"), ctx.main.id);
  if (!prepared.ok) throw new Error(prepared.fileError);
  await commitImport(db, { userId: ctx.user.id, accountId: ctx.main.id, filename: "x.csv", rowsTotal: 2, rowsError: 0, transactions: prepared.transactions });
  await sync(ctx.user.id, ctx.linkId);
  const all = await db.select().from(transactions).where(eq(transactions.accountId, ctx.main.id));
  const row = all.find((r) => r.source === "sync");
  const early = all.find((r) => r.date === "2026-09-28");
  const late = all.find((r) => r.date === "2026-10-02");
  if (!row || !early || !late) throw new Error("setup");
  return { ...ctx, row, early, late };
}

const count = async () => (await db.select().from(transactions)).length;

beforeEach(resetDb);

describe("possible duplicates", () => {
  it("the queue item lists both candidates", async () => {
    const { user, row, early, late } = await possible();
    const queue = await listReviewQueue(db, user.id);
    const item = queue.items.find((i) => i.id === row.id);
    expect(item?.possibleDuplicates.map((d) => d.id)).toEqual([late.id, early.id]);
    expect(item?.possibleDuplicates[0]).toMatchObject({ date: "2026-10-02", amountCents: -588, name: "PAIN DEUX", source: "csv" });
    expect(item?.possibleDuplicates[0].importedAt).toBeInstanceOf(Date);
    expect(queue.items.find((i) => i.id === early.id)?.possibleDuplicates).toEqual([]);
  });

  it("Same transaction keeps the candidate's data, deletes the row and a re-sync brings nothing", async () => {
    const { user, main, linkId, row, early } = await possible();
    const food = await createCategory(db, user.id, { name: "Food", color: "#336699" });
    if (!food.ok) throw new Error("category");
    await setTransactionCategory(db, user.id, early.id, food.category.id);
    await setTransactionNote(db, user.id, early.id, "cake");
    await addTagsToTransaction(db, user.id, early.id, ["party"]);

    expect(await mergeDuplicate(db, user.id, row.id, early.id)).toEqual({ ok: true });

    const rows = await db.select().from(transactions).where(eq(transactions.accountId, main.id));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === row.id)).toBeUndefined();
    expect(rows.find((r) => r.id === early.id)).toMatchObject({ categoryId: food.category.id, note: "cake" });
    expect((await loadTransactionTags(db, user.id, [early.id])).get(early.id)?.map((t) => t.name)).toEqual(["party"]);
    const [match] = await db.select().from(transactionMatches).where(eq(transactionMatches.accountId, main.id));
    expect(match).toMatchObject({ transactionId: early.id, source: "sync", externalId: "E-BAKERY", dedupeHash: row.dedupeHash });
    expect(await db.select().from(duplicateCandidates)).toHaveLength(0);

    expect(await sync(user.id, linkId)).toMatchObject({ ok: true, inserted: 0, duplicate: 1 });
    expect(await count()).toBe(2);
  });

  it("Keep both clears the links, keeps the row and a re-sync brings nothing", async () => {
    const { user, linkId, row } = await possible();
    expect(await keepBoth(db, user.id, row.id)).toBe(true);
    expect(await db.select().from(duplicateCandidates)).toHaveLength(0);
    const queue = await listReviewQueue(db, user.id);
    expect(queue.items.find((i) => i.id === row.id)?.possibleDuplicates).toEqual([]);
    expect(await sync(user.id, linkId)).toMatchObject({ ok: true, inserted: 0, duplicate: 1 });
    expect(await count()).toBe(3);
  });

  it("refuses another user's ids", async () => {
    const { row, early } = await possible();
    const other = await createTestUser();
    expect(await mergeDuplicate(db, other.id, row.id, early.id)).toEqual({ ok: false, error: "notFound" });
    expect(await keepBoth(db, other.id, row.id)).toBe(false);
    expect(await db.select().from(duplicateCandidates)).toHaveLength(2);
    expect(await count()).toBe(3);
  });

  it("refuses a row that is not a candidate", async () => {
    const { user, row, early, late } = await possible();
    expect(await mergeDuplicate(db, user.id, early.id, late.id)).toEqual({ ok: false, error: "notFound" });
    expect(await mergeDuplicate(db, user.id, row.id, row.id)).toEqual({ ok: false, error: "notFound" });
    expect(await count()).toBe(3);
  });
});
