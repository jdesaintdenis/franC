// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { imports, transactions, transferRejections, transfers } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { createAccount, deleteAccount, listAccounts } from "./accounts";
import {
  countTransfersInRange,
  getMonthlyTrend,
  getMonthTotals,
  getSpendingByCategory,
  getSubcategorySpending,
} from "./dashboard";
import { undoImport } from "./imports";
import { provisionUserDefaults } from "./provision";
import { listRecurring, refreshRecurring } from "./recurring";
import { countTransactions, listTransactions } from "./transactions";
import {
  confirmTransfer,
  getTransferForTransaction,
  linkTransfer,
  listTransferCandidates,
  refreshTransfers,
  unlinkTransfer,
} from "./transfers";
import { categories } from "../schema";

let hashCounter = 0;

interface Row {
  date: string;
  amountCents: number;
  label?: string;
  bankSubcategory?: string;
  categoryId?: string;
}

async function seed(userId: string, accountId: string, rows: Row[]): Promise<{ importId: string; ids: string[] }> {
  const [imp] = await db
    .insert(imports)
    .values({ userId, accountId, filename: "x.csv", rowsTotal: rows.length, rowsError: 0 })
    .returning();
  const inserted = await db
    .insert(transactions)
    .values(
      rows.map((r) => ({
        userId,
        accountId,
        importId: imp.id,
        date: r.date,
        amountCents: r.amountCents,
        labelRaw: r.label ?? "L",
        labelNormalized: r.label ?? "L",
        labelDisplay: r.label ?? "L",
        bankSubcategory: r.bankSubcategory ?? null,
        categoryId: r.categoryId ?? null,
        dedupeHash: `t${hashCounter++}`,
        occurrenceIndex: 0,
      })),
    )
    .returning({ id: transactions.id });
  return { importId: imp.id, ids: inserted.map((r) => r.id) };
}

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [main] = await listAccounts(user.id);
  const created = await createAccount(db, user.id, "Savings");
  if (!created.ok) throw new Error("createAccount failed");
  return { user, main, savings: created.account };
}

const RANGE = { from: "2026-03-01", to: "2026-03-31" };

describe("refreshTransfers", () => {
  beforeEach(resetDb);

  it("inserts detected pairs and is idempotent", async () => {
    const { user, main, savings } = await setup();
    const a = await seed(user.id, main.id, [{ date: "2026-03-10", amountCents: -5000 }]);
    const b = await seed(user.id, savings.id, [{ date: "2026-03-12", amountCents: 5000 }]);

    expect(await refreshTransfers(db, user.id)).toBe(1);
    expect(await refreshTransfers(db, user.id)).toBe(0);

    const rows = await db.select().from(transfers).where(eq(transfers.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outTransactionId: a.ids[0], inTransactionId: b.ids[0], status: "detected" });
  });

  it("creates confirmed pairs for the bank's Virement interne tag", async () => {
    const { user, main, savings } = await setup();
    await seed(user.id, main.id, [{ date: "2026-03-10", amountCents: -5000, bankSubcategory: "Virement interne" }]);
    await seed(user.id, savings.id, [{ date: "2026-03-10", amountCents: 5000 }]);
    await refreshTransfers(db, user.id);
    const [row] = await db.select().from(transfers);
    expect(row.status).toBe("confirmed");
  });

  it("pairs when the second account's rows arrive later, and never touches existing pairs", async () => {
    const { user, main, savings } = await setup();
    await seed(user.id, main.id, [{ date: "2026-03-10", amountCents: -5000 }]);
    expect(await refreshTransfers(db, user.id)).toBe(0);
    await seed(user.id, savings.id, [{ date: "2026-03-10", amountCents: 5000 }]);
    expect(await refreshTransfers(db, user.id)).toBe(1);
    // A closer, later-arriving candidate doesn't steal from an existing pair.
    await seed(user.id, savings.id, [{ date: "2026-03-10", amountCents: 5000 }]);
    expect(await refreshTransfers(db, user.id)).toBe(0);
    expect(await db.select().from(transfers)).toHaveLength(1);
  });

  it("does not pair across users", async () => {
    const one = await setup();
    const two = await setup();
    await seed(one.user.id, one.main.id, [{ date: "2026-03-10", amountCents: -5000 }]);
    await seed(two.user.id, two.main.id, [{ date: "2026-03-10", amountCents: 5000 }]);
    expect(await refreshTransfers(db, one.user.id)).toBe(0);
    expect(await refreshTransfers(db, two.user.id)).toBe(0);
  });
});

describe("confirm and unlink", () => {
  beforeEach(resetDb);

  it("confirms a detected pair", async () => {
    const { user, main, savings } = await setup();
    await seed(user.id, main.id, [{ date: "2026-03-10", amountCents: -5000 }]);
    await seed(user.id, savings.id, [{ date: "2026-03-10", amountCents: 5000 }]);
    await refreshTransfers(db, user.id);
    const [pair] = await db.select().from(transfers);
    const confirmed = await confirmTransfer(db, user.id, pair.id);
    expect(confirmed?.status).toBe("confirmed");
  });

  it("unlink deletes the pair, records a rejection and is not re-detected", async () => {
    const { user, main, savings } = await setup();
    const a = await seed(user.id, main.id, [{ date: "2026-03-10", amountCents: -5000 }]);
    const b = await seed(user.id, savings.id, [{ date: "2026-03-10", amountCents: 5000 }]);
    await refreshTransfers(db, user.id);
    const [pair] = await db.select().from(transfers);

    expect(await unlinkTransfer(db, user.id, pair.id)).not.toBeNull();
    expect(await db.select().from(transfers)).toHaveLength(0);
    expect(await db.select().from(transferRejections)).toEqual([
      expect.objectContaining({ outTransactionId: a.ids[0], inTransactionId: b.ids[0], userId: user.id }),
    ]);
    expect(await refreshTransfers(db, user.id)).toBe(0);
    expect(await unlinkTransfer(db, user.id, pair.id)).toBeNull();
  });

  it("refuses another user's transfer", async () => {
    const one = await setup();
    const two = await setup();
    await seed(one.user.id, one.main.id, [{ date: "2026-03-10", amountCents: -5000 }]);
    await seed(one.user.id, one.savings.id, [{ date: "2026-03-10", amountCents: 5000 }]);
    await refreshTransfers(db, one.user.id);
    const [pair] = await db.select().from(transfers);

    expect(await confirmTransfer(db, two.user.id, pair.id)).toBeNull();
    expect(await unlinkTransfer(db, two.user.id, pair.id)).toBeNull();
    const [after] = await db.select().from(transfers);
    expect(after.status).toBe("detected");
    expect(await db.select().from(transferRejections)).toHaveLength(0);
  });
});

describe("linkTransfer", () => {
  beforeEach(resetDb);

  it("links by hand in either argument order, as confirmed", async () => {
    const { user, main, savings } = await setup();
    const a = await seed(user.id, main.id, [{ date: "2026-03-01", amountCents: -5000 }]);
    const b = await seed(user.id, savings.id, [{ date: "2026-03-07", amountCents: 5000 }]);
    const result = await linkTransfer(db, user.id, b.ids[0], a.ids[0]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transfer).toMatchObject({
        outTransactionId: a.ids[0],
        inTransactionId: b.ids[0],
        status: "confirmed",
      });
    }
  });

  it("clears an earlier rejection of the pair", async () => {
    const { user, main, savings } = await setup();
    const a = await seed(user.id, main.id, [{ date: "2026-03-01", amountCents: -5000 }]);
    const b = await seed(user.id, savings.id, [{ date: "2026-03-01", amountCents: 5000 }]);
    await refreshTransfers(db, user.id);
    const [pair] = await db.select().from(transfers);
    await unlinkTransfer(db, user.id, pair.id);
    expect((await linkTransfer(db, user.id, a.ids[0], b.ids[0])).ok).toBe(true);
    expect(await db.select().from(transferRejections)).toHaveLength(0);
  });

  it("validates signs, amounts and accounts", async () => {
    const { user, main, savings } = await setup();
    const a = await seed(user.id, main.id, [
      { date: "2026-03-01", amountCents: -5000 },
      { date: "2026-03-01", amountCents: -100 },
      { date: "2026-03-01", amountCents: 5000 },
    ]);
    const b = await seed(user.id, savings.id, [
      { date: "2026-03-01", amountCents: 5000 },
      { date: "2026-03-01", amountCents: -5000 },
    ]);
    expect(await linkTransfer(db, user.id, a.ids[0], a.ids[2])).toEqual({ ok: false, error: "sameAccount" });
    expect(await linkTransfer(db, user.id, a.ids[0], a.ids[1])).toEqual({ ok: false, error: "sameSign" });
    expect(await linkTransfer(db, user.id, a.ids[1], b.ids[0])).toEqual({ ok: false, error: "amountMismatch" });
    expect(await linkTransfer(db, user.id, a.ids[0], b.ids[1])).toEqual({ ok: false, error: "sameSign" });
    expect(await linkTransfer(db, user.id, a.ids[0], a.ids[0])).toEqual({ ok: false, error: "notFound" });
    expect(await db.select().from(transfers)).toHaveLength(0);
  });

  it("refuses when either row is already paired", async () => {
    const { user, main, savings } = await setup();
    const a = await seed(user.id, main.id, [
      { date: "2026-03-01", amountCents: -5000 },
      { date: "2026-03-02", amountCents: -5000 },
    ]);
    const b = await seed(user.id, savings.id, [
      { date: "2026-03-01", amountCents: 5000 },
      { date: "2026-03-02", amountCents: 5000 },
    ]);
    expect((await linkTransfer(db, user.id, a.ids[0], b.ids[0])).ok).toBe(true);
    expect(await linkTransfer(db, user.id, a.ids[0], b.ids[1])).toEqual({ ok: false, error: "alreadyLinked" });
    expect(await linkTransfer(db, user.id, a.ids[1], b.ids[0])).toEqual({ ok: false, error: "alreadyLinked" });
    expect(await db.select().from(transfers)).toHaveLength(1);
  });

  it("refuses foreign or unknown ids", async () => {
    const one = await setup();
    const two = await setup();
    const a = await seed(one.user.id, one.main.id, [{ date: "2026-03-01", amountCents: -5000 }]);
    const b = await seed(two.user.id, two.main.id, [{ date: "2026-03-01", amountCents: 5000 }]);
    expect(await linkTransfer(db, one.user.id, a.ids[0], b.ids[0])).toEqual({ ok: false, error: "notFound" });
    expect(await linkTransfer(db, two.user.id, a.ids[0], b.ids[0])).toEqual({ ok: false, error: "notFound" });
    expect(
      await linkTransfer(db, one.user.id, a.ids[0], "00000000-0000-4000-8000-000000000000"),
    ).toEqual({ ok: false, error: "notFound" });
  });
});

describe("candidates and lookup", () => {
  beforeEach(resetDb);

  it("lists opposite equal unpaired rows on other accounts within 7 days, closest first", async () => {
    const { user, main, savings } = await setup();
    const src = await seed(user.id, main.id, [
      { date: "2026-03-10", amountCents: -5000 },
      { date: "2026-03-10", amountCents: 5000 }, // same account
    ]);
    const other = await seed(user.id, savings.id, [
      { date: "2026-03-17", amountCents: 5000, label: "far" },
      { date: "2026-03-11", amountCents: 5000, label: "near" },
      { date: "2026-03-18", amountCents: 5000, label: "too far" },
      { date: "2026-03-10", amountCents: 4999, label: "other amount" },
      { date: "2026-03-10", amountCents: -5000, label: "same sign" },
    ]);
    const candidates = await listTransferCandidates(db, user.id, src.ids[0]);
    expect(candidates?.map((c) => [c.label, c.gapDays, c.accountName])).toEqual([
      ["near", 1, "Savings"],
      ["far", 7, "Savings"],
    ]);

    // Paired rows are not offered and have no candidates themselves.
    await linkTransfer(db, user.id, src.ids[0], other.ids[1]);
    expect(await listTransferCandidates(db, user.id, src.ids[0])).toEqual([]);
    expect((await listTransferCandidates(db, user.id, other.ids[0])) ?? []).toEqual([]);
  });

  it("returns null for foreign transactions and scopes results by user", async () => {
    const one = await setup();
    const two = await setup();
    const a = await seed(one.user.id, one.main.id, [{ date: "2026-03-10", amountCents: -5000 }]);
    await seed(two.user.id, two.main.id, [{ date: "2026-03-10", amountCents: 5000 }]);
    expect(await listTransferCandidates(db, two.user.id, a.ids[0])).toBeNull();
    expect(await listTransferCandidates(db, one.user.id, a.ids[0])).toEqual([]);
  });

  it("getTransferForTransaction shows the counterpart from either side and is scoped", async () => {
    const { user, main, savings } = await setup();
    const a = await seed(user.id, main.id, [{ date: "2026-03-10", amountCents: -5000, label: "out" }]);
    const b = await seed(user.id, savings.id, [{ date: "2026-03-11", amountCents: 5000, label: "in" }]);
    expect(await getTransferForTransaction(db, user.id, a.ids[0])).toBeNull();
    await refreshTransfers(db, user.id);

    const fromOut = await getTransferForTransaction(db, user.id, a.ids[0]);
    expect(fromOut).toMatchObject({
      status: "detected",
      counterpart: { id: b.ids[0], label: "in", accountName: "Savings", amountCents: 5000, date: "2026-03-11" },
    });
    const fromIn = await getTransferForTransaction(db, user.id, b.ids[0]);
    expect(fromIn?.counterpart.id).toBe(a.ids[0]);

    const other = await createTestUser();
    expect(await getTransferForTransaction(db, other.id, a.ids[0])).toBeNull();
  });
});

describe("cascades", () => {
  beforeEach(resetDb);

  it("undo import frees the other side", async () => {
    const { user, main, savings } = await setup();
    const a = await seed(user.id, main.id, [{ date: "2026-03-10", amountCents: -5000 }]);
    const b = await seed(user.id, savings.id, [{ date: "2026-03-10", amountCents: 5000 }]);
    await refreshTransfers(db, user.id);

    await undoImport(db, user.id, a.importId);
    expect(await db.select().from(transfers)).toHaveLength(0);
    expect(await getTransferForTransaction(db, user.id, b.ids[0])).toBeNull();
    const totals = await getMonthTotals(db, user.id, RANGE);
    expect(totals.incomeCents).toBe(5000);
  });

  it("deleting an account frees the other side and drops rejections", async () => {
    const { user, main, savings } = await setup();
    await seed(user.id, main.id, [
      { date: "2026-03-10", amountCents: -5000 },
      { date: "2026-03-20", amountCents: -700 },
    ]);
    await seed(user.id, savings.id, [
      { date: "2026-03-10", amountCents: 5000 },
      { date: "2026-03-20", amountCents: 700 },
    ]);
    await refreshTransfers(db, user.id);
    const pairs = await db.select().from(transfers);
    await unlinkTransfer(db, user.id, pairs[0].id);
    expect(await db.select().from(transferRejections)).toHaveLength(1);

    const result = await deleteAccount(db, user.id, savings.id);
    expect(result.ok).toBe(true);
    expect(await db.select().from(transfers)).toHaveLength(0);
    expect(await db.select().from(transferRejections)).toHaveLength(0);
    const totals = await getMonthTotals(db, user.id, RANGE);
    expect(totals.spentCents).toBe(5700);
  });
});

describe("dashboard exclusion", () => {
  beforeEach(resetDb);

  async function withTransfer() {
    const { user, main, savings } = await setup();
    const [groceries] = await db
      .insert(categories)
      .values({ userId: user.id, name: "Groceries", color: "#000000" })
      .returning();
    await seed(user.id, main.id, [
      { date: "2026-03-10", amountCents: -5000, categoryId: groceries.id },
      { date: "2026-03-11", amountCents: -1000, categoryId: groceries.id },
      { date: "2026-03-12", amountCents: 20000 },
    ]);
    await seed(user.id, savings.id, [
      { date: "2026-03-11", amountCents: 5000 },
      { date: "2026-03-15", amountCents: -300 },
    ]);
    expect(await refreshTransfers(db, user.id)).toBe(1);
    return { user, main, savings, groceries };
  }

  it("excludes transfer rows from totals, categories, subcategories and trend", async () => {
    const { user, main, savings, groceries } = await withTransfer();

    expect(await getMonthTotals(db, user.id, RANGE)).toEqual({
      spentCents: 1300,
      incomeCents: 20000,
      netCents: 18700,
      count: 3,
    });
    expect(await getMonthTotals(db, user.id, RANGE, { accountId: main.id })).toMatchObject({
      spentCents: 1000,
      incomeCents: 20000,
      count: 2,
    });
    expect(await getMonthTotals(db, user.id, RANGE, { accountId: savings.id })).toMatchObject({
      spentCents: 300,
      incomeCents: 0,
      count: 1,
    });

    const categoriesAll = await getSpendingByCategory(db, user.id, RANGE);
    expect(categoriesAll.find((c) => c.name === "Groceries")?.spentCents).toBe(1000);
    const categoriesMain = await getSpendingByCategory(db, user.id, RANGE, { accountId: main.id });
    expect(categoriesMain.find((c) => c.name === "Groceries")?.spentCents).toBe(1000);

    const sub = await getSubcategorySpending(db, user.id, RANGE, groceries.id);
    expect(sub).toEqual([expect.objectContaining({ spentCents: 1000 })]);

    expect(await getMonthlyTrend(db, user.id, "2026-03", "2026-03")).toEqual([
      { month: "2026-03", spentCents: 1300, incomeCents: 20000 },
    ]);
    expect(await getMonthlyTrend(db, user.id, "2026-03", "2026-03", { accountId: savings.id })).toEqual([
      { month: "2026-03", spentCents: 300, incomeCents: 0 },
    ]);
  });

  it("counts transfer pairs with a leg in range and account", async () => {
    const { user, main, savings } = await withTransfer();
    expect(await countTransfersInRange(db, user.id, RANGE)).toBe(1);
    expect(await countTransfersInRange(db, user.id, RANGE, { accountId: main.id })).toBe(1);
    expect(await countTransfersInRange(db, user.id, RANGE, { accountId: savings.id })).toBe(1);
    expect(await countTransfersInRange(db, user.id, { from: "2026-04-01", to: "2026-04-30" })).toBe(0);
    // Only the outflow (Mar 10) falls in this range: the pair still counts once.
    expect(await countTransfersInRange(db, user.id, { from: "2026-03-10", to: "2026-03-10" })).toBe(1);

    const other = await createTestUser();
    expect(await countTransfersInRange(db, other.id, RANGE)).toBe(0);
    expect(await countTransfersInRange(db, user.id, RANGE, { accountId: "00000000-0000-4000-8000-000000000000" })).toBe(0);
  });

  it("unlinking brings the rows back into the totals", async () => {
    const { user } = await withTransfer();
    const [pair] = await db.select().from(transfers);
    await unlinkTransfer(db, user.id, pair.id);
    expect((await getMonthTotals(db, user.id, RANGE)).spentCents).toBe(6300);
  });
});

describe("transactions list", () => {
  beforeEach(resetDb);

  it("filters with transfers=hide|only and reports transfer info", async () => {
    const { user, main, savings } = await setup();
    const a = await seed(user.id, main.id, [
      { date: "2026-03-10", amountCents: -5000, label: "out" },
      { date: "2026-03-12", amountCents: -100, label: "coffee" },
    ]);
    const b = await seed(user.id, savings.id, [{ date: "2026-03-11", amountCents: 5000, label: "in" }]);
    await refreshTransfers(db, user.id);

    const all = await listTransactions(db, user.id, { direction: "all" }, null);
    expect(all.items).toHaveLength(3);
    const outItem = all.items.find((i) => i.id === a.ids[0]);
    expect(outItem?.transfer).toMatchObject({
      status: "detected",
      counterpartAccountName: "Savings",
      counterpartDate: "2026-03-11",
      counterpartAmountCents: 5000,
    });
    const inItem = all.items.find((i) => i.id === b.ids[0]);
    expect(inItem?.transfer).toMatchObject({ counterpartAccountName: main.name, counterpartAmountCents: -5000 });
    expect(all.items.find((i) => i.id === a.ids[1])?.transfer).toBeNull();

    const hidden = await listTransactions(db, user.id, { direction: "all", transfers: "hide" }, null);
    expect(hidden.items.map((i) => i.label)).toEqual(["coffee"]);
    const only = await listTransactions(db, user.id, { direction: "all", transfers: "only" }, null);
    expect(only.items.map((i) => i.label).sort()).toEqual(["in", "out"]);
    expect(await countTransactions(db, user.id, { direction: "all", transfers: "hide" })).toBe(1);
    expect(await countTransactions(db, user.id, { direction: "all", transfers: "only" })).toBe(2);

    const other = await createTestUser();
    expect((await listTransactions(db, other.id, { direction: "all", transfers: "only" }, null)).items).toEqual([]);
  });
});

describe("recurring", () => {
  beforeEach(resetDb);

  it("skips rows that are in a transfer but keeps unpaired ones", async () => {
    const { user, main, savings } = await setup();
    const months = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"];
    // Monthly move to savings (paired) and a monthly payment to an outside account (unpaired).
    await seed(user.id, main.id, months.map((date) => ({ date, amountCents: -20000, label: "VIR EPARGNE" })));
    await seed(user.id, savings.id, months.map((date) => ({ date, amountCents: 20000, label: "VIR EPARGNE" })));
    await seed(user.id, main.id, months.map((date) => ({ date, amountCents: -7500, label: "VIR LOYER GARAGE" })));

    expect(await refreshTransfers(db, user.id)).toBe(4);
    await refreshRecurring(db, user.id);
    const items = await listRecurring(db, user.id);
    expect(items.map((i) => i.typicalAmountCents)).toEqual([-7500]);
  });
});
