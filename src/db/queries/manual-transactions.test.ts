// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { prepareImport } from "../../lib/import";
import { db } from "../client";
import { imports, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { createAccount, listAccounts, setAccountSavings } from "./accounts";
import { createCategory } from "./categories";
import { createRule } from "./category-rules";
import { commitImport, undoImport } from "./imports";
import {
  countNotFound,
  createManualTransaction,
  deleteManualTransaction,
  linkManualToBankRow,
  listLinkCandidates,
  listNotFound,
  manualVersion,
  setAwaitingBank,
  updateManualTransaction,
} from "./manual-transactions";
import { provisionUserDefaults } from "./provision";
import { getAccountFreshness } from "./import-reminder";
import { loadTransactionTags, setTransactionNote } from "./tags";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";
const csvLine = (date: string, label: string, amount = "-12,50", ref = "R1") =>
  `${date};${label};${label} OPERATION;${ref};;Carte;;;${amount};;${date};${date};0`;

async function importCsv(userId: string, accountId: string, lines: string[]) {
  const prepared = prepareImport([HEADER, ...lines].join("\n"), accountId);
  if (!prepared.ok) throw new Error(prepared.fileError);
  return commitImport(db, { userId, accountId, filename: "x.csv", rowsTotal: prepared.rowsTotal, rowsError: 0, transactions: prepared.transactions });
}

const rowsOf = (accountId: string) => db.select().from(transactions).where(eq(transactions.accountId, accountId));

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [main] = await listAccounts(user.id);
  return { user, main };
}

const hand = (accountId: string, over: Partial<Parameters<typeof createManualTransaction>[2]> = {}) => ({
  accountId,
  amountCents: -1250,
  label: "Lunch",
  date: "2026-09-30",
  categoryId: null,
  ...over,
});

describe("createManualTransaction", () => {
  beforeEach(resetDb);

  it("on an account nothing feeds: final, waiting for a category, in the hidden franc import", async () => {
    const { user, main } = await setup();
    const res = await createManualTransaction(db, user.id, hand(main.id));
    expect(res).toMatchObject({ ok: true, awaitingBank: false });
    const [row] = await rowsOf(main.id);
    expect(row).toMatchObject({ source: "manual", amountCents: -1250, awaitingBank: false, occurrenceIndex: 0 });
    // No category yet: the row waits in the review queue until it has one (SPEC §73 A).
    expect(row.reviewedAt).toBeNull();
    expect(row.dedupeHash).toBe(`manual:${row.id}`);
    const [imp] = await db.select().from(imports).where(eq(imports.id, row.importId));
    expect(imp.kind).toBe("franc");
  });

  it("on an account fed by CSV: waits for the bank", async () => {
    const { user, main } = await setup();
    await importCsv(user.id, main.id, [csvLine("01/09/2026", "OLD", "-3,00", "R0")]);
    expect(await createManualTransaction(db, user.id, hand(main.id))).toMatchObject({ ok: true, awaitingBank: true });
  });

  it("refuses Savings accounts and other users' accounts", async () => {
    const { user, main } = await setup();
    const created = await createAccount(db, user.id, "Livret A");
    if (!created.ok) throw new Error("createAccount");
    await setAccountSavings(db, user.id, created.account.id, true);
    expect(await createManualTransaction(db, user.id, hand(created.account.id))).toEqual({ ok: false, error: "notCurrent" });
    const other = await createTestUser();
    expect(await createManualTransaction(db, other.id, hand(main.id))).toEqual({ ok: false, error: "notFound" });
  });

  it("applies the user's rules when no category is given", async () => {
    const { user, main } = await setup();
    const food = await createCategory(db, user.id, { name: "Food", color: "#336699" });
    if (!food.ok) throw new Error("category");
    await createRule(db, user.id, { matchType: "contains", pattern: "lunch", categoryId: food.category.id });
    await createManualTransaction(db, user.id, hand(main.id));
    const [row] = await rowsOf(main.id);
    expect(row).toMatchObject({ categoryId: food.category.id, categorySource: "rule" });
    expect(row.reviewedAt).not.toBeNull();
  });
});

describe("adoption by a later import", () => {
  beforeEach(resetDb);

  it("the bank row takes over the hand row: same id, date and label from the bank, category and note kept", async () => {
    const { user, main } = await setup();
    await importCsv(user.id, main.id, [csvLine("01/09/2026", "OLD", "-3,00", "R0")]);
    const food = await createCategory(db, user.id, { name: "Food", color: "#336699" });
    if (!food.ok) throw new Error("category");
    const created = await createManualTransaction(db, user.id, hand(main.id, { categoryId: food.category.id }));
    if (!created.ok) throw new Error("create");
    await setTransactionNote(db, user.id, created.id, "with Sam");

    const res = await importCsv(user.id, main.id, [csvLine("02/10/2026", "RESTAURANT", "-12,50", "R2")]);
    expect(res.rowsAdopted).toBe(1);
    const rows = await rowsOf(main.id);
    expect(rows).toHaveLength(2);
    const adopted = rows.find((r) => r.id === created.id)!;
    expect(adopted).toMatchObject({ source: "csv", awaitingBank: false, date: "2026-10-02", categoryId: food.category.id, note: "with Sam" });
    expect(adopted.dedupeHash).not.toBe(`manual:${created.id}`);

    // Same file again: nothing new.
    const again = await importCsv(user.id, main.id, [csvLine("02/10/2026", "RESTAURANT", "-12,50", "R2")]);
    expect(again.rowsAdopted).toBe(0);
    expect(await rowsOf(main.id)).toHaveLength(2);

    // Undo of the import leaves the adopted row (it belongs to the hand row's import).
    await undoImport(db, user.id, res.import.id);
    expect((await rowsOf(main.id)).some((r) => r.id === created.id)).toBe(true);
  });

  it("does not adopt a different amount or a row outside 3 days", async () => {
    const { user, main } = await setup();
    await importCsv(user.id, main.id, [csvLine("01/09/2026", "OLD", "-3,00", "R0")]);
    await createManualTransaction(db, user.id, hand(main.id));
    const res = await importCsv(user.id, main.id, [
      csvLine("30/09/2026", "A", "-13,00", "R3"),
      csvLine("10/10/2026", "B", "-12,50", "R4"),
    ]);
    expect(res.rowsAdopted).toBe(0);
    expect(await rowsOf(main.id)).toHaveLength(4);
  });
});

describe("update and delete", () => {
  beforeEach(resetDb);

  it("edits a hand row, deletes it and returns the snapshot; refuses other rows", async () => {
    const { user, main } = await setup();
    const created = await createManualTransaction(db, user.id, hand(main.id));
    if (!created.ok) throw new Error("create");
    const upd = await updateManualTransaction(db, user.id, created.id, { amountCents: -2000, label: "Dinner", date: "2026-09-29" });
    expect(upd).toEqual({ ok: true });
    expect((await rowsOf(main.id))[0]).toMatchObject({ amountCents: -2000, date: "2026-09-29" });
    const snap = await deleteManualTransaction(db, user.id, created.id);
    expect(snap).toMatchObject({ amountCents: -2000, label: "Dinner", accountId: main.id });
    expect(await rowsOf(main.id)).toHaveLength(0);

    const imported = await importCsv(user.id, main.id, [csvLine("01/09/2026", "OLD", "-3,00", "R0")]);
    const [bankRow] = await rowsOf(main.id);
    expect(imported.import.id).toBeTruthy();
    expect(await deleteManualTransaction(db, user.id, bankRow.id)).toBeNull();
    expect(await updateManualTransaction(db, user.id, bankRow.id, { amountCents: -1, label: "x", date: "2026-09-01" })).toEqual({ ok: false, error: "notFound" });
  });

  it("restores tags and note from a snapshot", async () => {
    const { user, main } = await setup();
    const created = await createManualTransaction(db, user.id, hand(main.id, { note: "n" }));
    if (!created.ok) throw new Error("create");
    expect((await rowsOf(main.id))[0].note).toBe("n");
    expect(await loadTransactionTags(db, user.id, [created.id])).toBeDefined();
  });
});

describe("not found and link", () => {
  beforeEach(resetDb);

  async function waiting(date: string) {
    const { user, main } = await setup();
    await importCsv(user.id, main.id, [csvLine("01/08/2026", "OLD", "-3,00", "R0")]);
    const created = await createManualTransaction(db, user.id, hand(main.id, { date }));
    if (!created.ok) throw new Error("create");
    return { user, main, id: created.id };
  }

  it("lists only waiting rows older than 7 days; Keep removes it; version changes", async () => {
    const { user, id } = await waiting("2026-09-30");
    expect(await countNotFound(db, user.id, "2026-10-07")).toBe(0);
    expect(await countNotFound(db, user.id, "2026-10-08")).toBe(1);
    const before = await manualVersion(db, user.id);
    expect((await listNotFound(db, user.id, "2026-10-08")).map((r) => r.id)).toEqual([id]);
    expect(await setAwaitingBank(db, user.id, id, false)).toBe(true);
    expect(await countNotFound(db, user.id, "2026-10-08")).toBe(0);
    expect(await manualVersion(db, user.id)).not.toBe(before);
  });

  it("links to a bank row: the bank row keeps its identity, the hand row goes", async () => {
    const { user, main, id } = await waiting("2026-09-10");
    // A bank row 5 days away: too far for adoption, inside the link window.
    await importCsv(user.id, main.id, [csvLine("15/09/2026", "RESTAURANT", "-12,50", "R5")]);
    const bank = (await rowsOf(main.id)).find((r) => r.amountCents === -1250 && r.source === "csv")!;
    const candidates = await listLinkCandidates(db, user.id, id);
    expect(candidates.map((c) => c.id)).toEqual([bank.id]);
    expect(await linkManualToBankRow(db, user.id, id, bank.id)).toMatchObject({ ok: true });
    const rows = await rowsOf(main.id);
    expect(rows.some((r) => r.id === id)).toBe(false);
    expect(rows.some((r) => r.id === bank.id)).toBe(true);
    const stranger = await createTestUser();
    expect(await linkManualToBankRow(db, stranger.id, id, bank.id)).toEqual({ ok: false, error: "notFound" });
  });
});

describe("elsewhere", () => {
  beforeEach(resetDb);

  it("hand rows do not count as the account's latest date or as an import for the reminder", async () => {
    const { user, main } = await setup();
    await createManualTransaction(db, user.id, hand(main.id, { date: "2026-10-01" }));
    const [fresh] = await getAccountFreshness(db, user.id);
    expect(fresh.latestDate).toBeNull();
    expect(fresh.lastImportDate).toBeNull();
  });

  it("an account holding hand rows can't become Savings", async () => {
    const { user } = await setup();
    const second = await createAccount(db, user.id, "Second");
    if (!second.ok) throw new Error("createAccount");
    await createManualTransaction(db, user.id, hand(second.account.id));
    expect(await setAccountSavings(db, user.id, second.account.id, true)).toEqual({ ok: false, error: "hasManual" });
  });
});
