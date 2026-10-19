// @vitest-environment node
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { EnableBankingClient } from "../../lib/bank-sync/client";
import { BankSyncError } from "../../lib/bank-sync/errors";
import type { BankBalance, BankTransaction } from "../../lib/bank-sync/schemas";
import { syncAccount } from "../../lib/bank-sync/sync";
import { prepareImportGuessed } from "../../lib/import/prepare-guessed";
import { db } from "../client";
import { accounts, balanceCheckpoints, bankAccountLinks, imports, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { listAccounts } from "./accounts";
import { getBalanceGaps, acceptBalanceGap, restoreBalanceGap } from "./balance-gaps";
import { getAccountBalances, isBankBalanceAccount, setAccountBalance, setAccountThreshold } from "./balance";
import { bankConnectionStore, deleteBankConnection, listBankConnections, saveBankLinks } from "./bank-connections";
import { bankSyncStore } from "./bank-sync";
import { commitImport } from "./imports";
import { provisionUserDefaults } from "./provision";

const NOW = new Date("2026-10-02T10:00:00Z");
const UNTIL = new Date("2027-03-31T00:00:00Z");
const store = bankSyncStore(db);
const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

let counter = 0;
async function seed(userId: string, accountId: string, rows: { date: string; bookedOn?: string; amountCents: number; ignored?: boolean }[]) {
  const [imp] = await db.insert(imports).values({ userId, accountId, filename: "x.csv" }).returning();
  await db.insert(transactions).values(
    rows.map((r) => ({
      userId,
      accountId,
      importId: imp.id,
      date: r.date,
      bookedOn: r.bookedOn ?? null,
      amountCents: r.amountCents,
      labelRaw: "L",
      labelNormalized: "L",
      labelDisplay: "L",
      ignoredAt: r.ignored ? new Date() : null,
      dedupeHash: `cp${counter++}`,
      occurrenceIndex: 0,
    })),
  );
}

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [main] = await listAccounts(user.id);
  return { user, main };
}

/** A user whose main account is linked to a bank account; returns the link and connection ids. */
async function linked() {
  const { user, main } = await setup();
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
  return { user, main, linkId: link.id, connectionId: connection.id };
}

const clbd = (amount: string, referenceDate: string): BankBalance => ({
  balance_type: "CLBD",
  balance_amount: { amount, currency: "EUR" },
  reference_date: referenceDate,
});

function syncWith(userId: string, linkId: string, balances: BankBalance[], transactionsList: BankTransaction[] = [], now = NOW) {
  const client = { getTransactions: async () => transactionsList, getBalances: async () => balances } as unknown as EnableBankingClient;
  return syncAccount({ client, store, now }, userId, linkId);
}

const checkpointsOf = (accountId: string) =>
  db.select().from(balanceCheckpoints).where(eq(balanceCheckpoints.accountId, accountId)).orderBy(balanceCheckpoints.date);

beforeEach(resetDb);

describe("migration 0029 data copy", () => {
  it("turns each starting balance into a manual checkpoint the day before, with the same balance", async () => {
    const { user, main } = await setup();
    await db.update(accounts).set({ startingBalanceCents: 100_000, startingBalanceDate: "2026-09-01" }).where(eq(accounts.id, main.id));
    await seed(user.id, main.id, [{ date: "2026-08-31", amountCents: -999 }, { date: "2026-09-01", amountCents: -1000 }, { date: "2026-09-10", amountCents: 500 }]);
    const before = await db.select().from(transactions).where(eq(transactions.accountId, main.id));

    const file = readFileSync(new URL("../migrations/0029_balance_checkpoints.sql", import.meta.url), "utf8");
    const copy = file.slice(file.indexOf("INSERT INTO"));
    await db.execute(sql.raw(copy));

    expect(await checkpointsOf(main.id)).toMatchObject([{ source: "manual", date: "2026-08-31", amountCents: 100_000, acceptedGapCents: 0 }]);
    const [balance] = await getAccountBalances(db, user.id);
    // Start of 1 Sept (100000) + the 1 Sept and 10 Sept rows; the 31 Aug row is before it.
    expect(balance).toMatchObject({ balanceCents: 99_500, asOf: "2026-09-10", source: "manual", startingBalanceDate: "2026-09-01", connected: false });
    expect(await db.select().from(transactions).where(eq(transactions.accountId, main.id))).toEqual(before);
  });
});

describe("getAccountBalances with a bank anchor", () => {
  it("a connected account without a bank balance still uses its manual one", async () => {
    const { user, main } = await linked();
    await setAccountBalance(db, user.id, main.id, { startingBalanceCents: 1000, startingBalanceDate: "2026-09-01", thresholdCents: 0 });
    await seed(user.id, main.id, [{ date: "2026-09-05", amountCents: -100 }]);
    expect((await getAccountBalances(db, user.id))[0]).toMatchObject({ balanceCents: 900, source: "manual", connected: true, bankName: null });
  });

  it("anchors on the latest bank balance and counts rows booked after it, by booking date", async () => {
    const { user, main, linkId } = await linked();
    await setAccountBalance(db, user.id, main.id, { startingBalanceCents: 50_000, startingBalanceDate: "2026-09-01", thresholdCents: 100 });
    await syncWith(user.id, linkId, [clbd("1000.00", "2026-10-01")]);
    await seed(user.id, main.id, [
      // Dated before the anchor but booked after it: counts.
      { date: "2026-09-30", bookedOn: "2026-10-03", amountCents: -2000 },
      // Dated after the anchor but booked on it: already in the bank's balance.
      { date: "2026-10-02", bookedOn: "2026-10-01", amountCents: -7000 },
      // No booking date: falls back to its date.
      { date: "2026-10-04", amountCents: 500 },
      { date: "2026-10-05", amountCents: -100, ignored: true },
    ]);
    const [balance] = await getAccountBalances(db, user.id);
    expect(balance).toMatchObject({
      balanceCents: 100_000 - 2000 + 500,
      asOf: "2026-10-04",
      source: "bank",
      bankName: "Caisse d'Epargne",
      connected: true,
      thresholdCents: 100,
      startingBalanceCents: 50_000,
    });
    expect(balance.fetchedAt).toEqual(NOW);
  });

  it("asOf is the anchor's day when nothing was booked after it", async () => {
    const { user, linkId } = await linked();
    await syncWith(user.id, linkId, [clbd("10.00", "2026-10-01")]);
    expect((await getAccountBalances(db, user.id))[0]).toMatchObject({ balanceCents: 1000, asOf: "2026-10-01" });
  });

  it("a disconnected account ignores its bank checkpoints", async () => {
    const { user, main, linkId, connectionId } = await linked();
    await setAccountBalance(db, user.id, main.id, { startingBalanceCents: 0, startingBalanceDate: "2026-09-01", thresholdCents: 0 });
    await syncWith(user.id, linkId, [clbd("10.00", "2026-10-01")]);
    await db.execute(sql`delete from bank_connections where id = ${connectionId}`);
    expect((await getAccountBalances(db, user.id))[0]).toMatchObject({ source: "manual", balanceCents: 0, connected: false });
  });
});

describe("saving the bank checkpoint", () => {
  it("a second sync the same day updates the reading but keeps the accepted gap", async () => {
    const { user, main, linkId } = await linked();
    await syncWith(user.id, linkId, [clbd("10.00", "2026-10-02")]);
    await db.update(balanceCheckpoints).set({ acceptedGapCents: 123 }).where(eq(balanceCheckpoints.accountId, main.id));
    const later = new Date("2026-10-02T18:00:00Z");
    await syncWith(user.id, linkId, [{ ...clbd("20.00", "2026-10-02"), balance_type: "CLBD" }], [], later);
    const rows = await checkpointsOf(main.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountCents: 2000, acceptedGapCents: 123, fetchedAt: later, balanceType: "CLBD", bankName: "Caisse d'Epargne", source: "bank" });
  });

  it("a day later adds a second checkpoint; a failed balance leaves the rows in and no checkpoint", async () => {
    const { user, main, linkId } = await linked();
    await syncWith(user.id, linkId, [clbd("10.00", "2026-10-01")]);
    await syncWith(user.id, linkId, [clbd("11.00", "2026-10-02")]);
    expect(await checkpointsOf(main.id)).toHaveLength(2);
    const failing = { getTransactions: async () => [], getBalances: async () => { throw new BankSyncError("bank_unavailable", 500); } } as unknown as EnableBankingClient;
    expect(await syncAccount({ client: failing, store, now: NOW }, user.id, linkId)).toMatchObject({ ok: true });
    expect(await checkpointsOf(main.id)).toHaveLength(2);
  });
});

describe("disconnect", () => {
  it("copies the latest bank balance to the manual checkpoint and keeps the bank ones", async () => {
    const { user, main, linkId, connectionId } = await linked();
    await setAccountBalance(db, user.id, main.id, { startingBalanceCents: 5, startingBalanceDate: "2026-09-01", thresholdCents: 0 });
    await syncWith(user.id, linkId, [clbd("10.00", "2026-10-01")]);
    await syncWith(user.id, linkId, [clbd("12.34", "2026-10-02")]);

    const other = await createTestUser();
    expect(await deleteBankConnection(db, other.id, connectionId)).toBeNull();
    expect(await checkpointsOf(main.id)).toHaveLength(3);

    expect(await deleteBankConnection(db, user.id, connectionId)).toEqual({ sessionId: "sess" });
    const rows = await checkpointsOf(main.id);
    expect(rows.map((r) => [r.source, r.date, r.amountCents]).sort()).toEqual([
      ["bank", "2026-10-01", 1000],
      ["bank", "2026-10-02", 1234],
      ["manual", "2026-10-02", 1234],
    ]);
    expect((await getAccountBalances(db, user.id))[0]).toMatchObject({ source: "manual", balanceCents: 1234, connected: false, startingBalanceDate: "2026-10-03" });
  });

  it("creates the manual checkpoint when the account had none", async () => {
    const { user, main, linkId, connectionId } = await linked();
    await syncWith(user.id, linkId, [clbd("10.00", "2026-10-01")]);
    await deleteBankConnection(db, user.id, connectionId);
    expect((await checkpointsOf(main.id)).filter((r) => r.source === "manual")).toMatchObject([{ date: "2026-10-01", amountCents: 1000 }]);
  });
});

describe("balance gaps", () => {
  it("lists a connected account whose rows don't add up, dated by booking day", async () => {
    const { user, main, linkId } = await linked();
    await setAccountBalance(db, user.id, main.id, { startingBalanceCents: 100_000, startingBalanceDate: "2026-09-02", thresholdCents: 0 });
    await syncWith(user.id, linkId, [clbd("940.00", "2026-09-09")]);
    await seed(user.id, main.id, [
      { date: "2026-09-04", bookedOn: "2026-09-05", amountCents: -5000 },
      { date: "2026-09-08", amountCents: -500, ignored: true },
    ]);
    const gaps = await getBalanceGaps(db, user.id);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ accountId: main.id, accountName: main.name, gap: { amountCents: -1000, from: "2026-09-02", to: "2026-09-09" } });

    // A row booked before the starting day is out of range; one inside closes the gap.
    await seed(user.id, main.id, [{ date: "2026-09-06", amountCents: -1000 }]);
    expect(await getBalanceGaps(db, user.id)).toEqual([]);
    expect(await getBalanceGaps(db, (await createTestUser()).id)).toEqual([]);
  });

  it("raises nothing for an account without a link or without a bank checkpoint", async () => {
    const { user, main } = await setup();
    await setAccountBalance(db, user.id, main.id, { startingBalanceCents: 100, startingBalanceDate: "2026-09-02", thresholdCents: 0 });
    await db.insert(balanceCheckpoints).values({ userId: user.id, accountId: main.id, date: "2026-09-09", amountCents: 5, source: "bank" });
    expect(await getBalanceGaps(db, user.id)).toEqual([]);
  });

  it("accept stores the difference on the latest bank checkpoint, restore puts the old value back", async () => {
    const { user, main, linkId } = await linked();
    await setAccountBalance(db, user.id, main.id, { startingBalanceCents: 100_000, startingBalanceDate: "2026-09-02", thresholdCents: 0 });
    await syncWith(user.id, linkId, [clbd("990.00", "2026-09-09")]);
    await syncWith(user.id, linkId, [clbd("980.00", "2026-09-10")]);
    const [first, latest] = await checkpointsOf(main.id).then((rows) => rows.filter((r) => r.source === "bank"));

    const accepted = await acceptBalanceGap(db, user.id, main.id);
    expect(accepted).toEqual({ ok: true, checkpointId: latest.id, previousCents: 0 });
    expect(await getBalanceGaps(db, user.id)).toEqual([]);
    const rows = await checkpointsOf(main.id);
    expect(rows.find((r) => r.id === latest.id)?.acceptedGapCents).toBe(-2000);
    expect(rows.find((r) => r.id === first.id)?.acceptedGapCents).toBe(0);
    // A transaction was not created.
    expect(await db.select().from(transactions).where(eq(transactions.accountId, main.id))).toHaveLength(0);

    // Accepting again with no gap changes nothing.
    expect(await acceptBalanceGap(db, user.id, main.id)).toMatchObject({ ok: true, previousCents: -2000 });

    expect(await restoreBalanceGap(db, user.id, latest.id, 0)).toEqual({ ok: true });
    expect(await getBalanceGaps(db, user.id)).toHaveLength(1);
  });

  it("accept and restore are scoped by user", async () => {
    const { user, main, linkId } = await linked();
    await syncWith(user.id, linkId, [clbd("990.00", "2026-09-09")]);
    const [checkpoint] = await checkpointsOf(main.id);
    const other = await createTestUser();
    expect(await acceptBalanceGap(db, other.id, main.id)).toEqual({ ok: false, error: "notFound" });
    expect(await restoreBalanceGap(db, other.id, checkpoint.id, 5)).toEqual({ ok: false, error: "notFound" });
    const [after] = await db.select().from(balanceCheckpoints).where(and(eq(balanceCheckpoints.id, checkpoint.id)));
    expect(after.acceptedGapCents).toBe(0);
  });
});

describe("booked_on", () => {
  const csvLine = (booked: string, op: string) => `${booked};PAIN;CB PAIN;R1;;Carte;;;-5,88;;${op};${op};0`;

  it("a CSV import stores the booking date without changing the dedupe hash", async () => {
    const { user, main } = await setup();
    const prepared = prepareImportGuessed([HEADER, csvLine("30/09/2026", "29/09/2026")].join("\n"), main.id);
    if (!prepared.ok) throw new Error("parse");
    const sameOperation = prepareImportGuessed([HEADER, csvLine("02/10/2026", "29/09/2026")].join("\n"), main.id);
    if (!sameOperation.ok) throw new Error("parse");
    expect(prepared.transactions[0].dedupeHash).toBe(sameOperation.transactions[0].dedupeHash);
    await commitImport(db, { userId: user.id, accountId: main.id, filename: "x.csv", rowsTotal: 1, rowsError: 0, transactions: prepared.transactions });
    const [row] = await db.select().from(transactions).where(eq(transactions.accountId, main.id));
    expect(row).toMatchObject({ date: "2026-09-29", bookedOn: "2026-09-30" });
  });

  it("a synced row merged into a CSV row without a booking date gives it one, and never overwrites", async () => {
    const { user, main, linkId } = await linked();
    const prepared = prepareImportGuessed([HEADER, csvLine("30/09/2026", "30/09/2026")].join("\n"), main.id);
    if (!prepared.ok) throw new Error("parse");
    await commitImport(db, { userId: user.id, accountId: main.id, filename: "x.csv", rowsTotal: 1, rowsError: 0, transactions: prepared.transactions });
    await db.update(transactions).set({ bookedOn: null }).where(eq(transactions.accountId, main.id));
    const bank = (booking: string): BankTransaction => ({
      entry_reference: "E1",
      transaction_amount: { amount: "5.88", currency: "EUR" },
      credit_debit_indicator: "DBIT",
      status: "BOOK",
      booking_date: booking,
      remittance_information: ["CB PAIN"],
    });
    await db.update(bankAccountLinks).set({ syncFrom: "2026-09-01" }).where(eq(bankAccountLinks.id, linkId));
    expect(await syncWith(user.id, linkId, [], [bank("2026-10-01")])).toMatchObject({ ok: true, inserted: 0, duplicate: 1 });
    const rows = await db.select().from(transactions).where(eq(transactions.accountId, main.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].bookedOn).toBe("2026-10-01");
    await syncWith(user.id, linkId, [], [bank("2026-10-05")]);
    expect((await db.select().from(transactions).where(eq(transactions.accountId, main.id)))[0].bookedOn).toBe("2026-10-01");
  });

  it("a synced row stores the bank's booking date", async () => {
    const { user, main, linkId } = await linked();
    await syncWith(user.id, linkId, [], [
      {
        entry_reference: "E2",
        transaction_amount: { amount: "5.88", currency: "EUR" },
        credit_debit_indicator: "DBIT",
        status: "BOOK",
        booking_date: "2026-10-01",
        remittance_information: ["CB BOULANGERIE DES L FACT 290926 4000XXXX1234"],
      },
    ]);
    const [row] = await db.select().from(transactions).where(eq(transactions.accountId, main.id));
    expect(row).toMatchObject({ date: "2026-09-29", bookedOn: "2026-10-01" });
  });
});

describe("bank-sourced balance guard", () => {
  it("is true only for a linked account that has read a bank balance", async () => {
    const { user, main, linkId } = await linked();
    expect(await isBankBalanceAccount(db, user.id, main.id)).toBe(false);
    await syncWith(user.id, linkId, [clbd("990.00", "2026-09-09")]);
    expect(await isBankBalanceAccount(db, user.id, main.id)).toBe(true);
    expect(await isBankBalanceAccount(db, (await createTestUser()).id, main.id)).toBe(false);
  });

  it("sets the threshold alone, scoped by user", async () => {
    const { user, main } = await setup();
    expect(await setAccountThreshold(db, user.id, main.id, 5000)).toEqual({ ok: true });
    const [row] = await db.select().from(accounts).where(eq(accounts.id, main.id));
    expect(row.lowBalanceThresholdCents).toBe(5000);
    expect(await setAccountThreshold(db, (await createTestUser()).id, main.id, 1)).toEqual({ ok: false, error: "notFound" });
  });
});
