// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { accounts, imports, merchants, recurring, savingsGoalContributions, savingsRules, transactions, transfers, transferRejections } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { createAccount, deleteAccount, getLastUsedAccountId, listAccounts, listAccountsWithStats, setAccountSavings } from "./accounts";
import { assignToGoal, createGoal, listGoals } from "./goals";
import { setAccountBalance } from "./balance";
import { listImports, undoImport } from "./imports";
import { provisionUserDefaults } from "./provision";
import { refreshRecurring } from "./recurring";
import {
  applySavingsRules,
  countMovedRows,
  deleteSavingsRule,
  getSavedByMonth,
  listSavingsRules,
  moveToSavings,
  removeSavingsMove,
  restoreSavingsRule,
  setMoveGoal,
} from "./savings";
import { getTransferForTransaction, linkTransfer, listTransferCandidates, refreshTransfers, unlinkTransfer } from "./transfers";

let counter = 0;

async function seed(
  userId: string,
  accountId: string,
  rows: Array<{ date: string; amountCents: number; label?: string; merchantId?: string }>,
): Promise<string[]> {
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
        merchantId: r.merchantId ?? null,
        dedupeHash: `s${counter++}`,
        occurrenceIndex: 0,
      })),
    )
    .returning({ id: transactions.id });
  return inserted.map((r) => r.id);
}

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [main] = await listAccounts(user.id);
  const created = await createAccount(db, user.id, "Livret A");
  if (!created.ok) throw new Error("createAccount failed");
  const switched = await setAccountSavings(db, user.id, created.account.id, true);
  if (!switched.ok) throw new Error(`setAccountSavings failed: ${switched.error}`);
  return { user, main, savings: created.account };
}

const OCT = { from: "2026-10-01", to: "2026-10-31" };

describe("setAccountSavings", () => {
  beforeEach(resetDb);

  it("switches to Savings, takes it out of safe to spend, and back while it holds no moves", async () => {
    const user = await createTestUser();
    await provisionUserDefaults(db, user.id);
    const [main] = await listAccounts(user.id);
    const created = await createAccount(db, user.id, "Livret A");
    if (!created.ok) throw new Error("createAccount failed");

    expect(await setAccountSavings(db, user.id, created.account.id, true)).toEqual({ ok: true });
    const [saved] = await db.select().from(accounts).where(eq(accounts.id, created.account.id));
    expect(saved.savings).toBe(true);
    expect(saved.inSafeToSpend).toBe(false);

    expect(await setAccountSavings(db, user.id, created.account.id, false)).toEqual({ ok: true });
    const [back] = await db.select().from(accounts).where(eq(accounts.id, created.account.id));
    expect(back.savings).toBe(false);
    expect(main.savings).toBe(false);
  });

  it("refuses the only current account, an account with imports, and another user's account", async () => {
    const user = await createTestUser();
    await provisionUserDefaults(db, user.id);
    const [main] = await listAccounts(user.id);
    expect(await setAccountSavings(db, user.id, main.id, true)).toEqual({ ok: false, error: "lastCurrent" });

    const created = await createAccount(db, user.id, "Joint");
    if (!created.ok) throw new Error("createAccount failed");
    await seed(user.id, created.account.id, [{ date: "2026-10-01", amountCents: -100 }]);
    expect(await setAccountSavings(db, user.id, created.account.id, true)).toEqual({ ok: false, error: "hasImports" });

    const stranger = await createTestUser();
    await provisionUserDefaults(db, stranger.id);
    expect(await setAccountSavings(db, stranger.id, created.account.id, true)).toEqual({ ok: false, error: "notFound" });
  });

  it("refuses going back to Current while the account holds moves", async () => {
    const { user, main, savings } = await setup();
    const [row] = await seed(user.id, main.id, [{ date: "2026-10-05", amountCents: -5000, label: "VIR LIVRET A" }]);
    await moveToSavings(db, user.id, { transactionId: row, accountId: savings.id, withRule: false });
    expect(await setAccountSavings(db, user.id, savings.id, false)).toEqual({ ok: false, error: "hasMoves" });
  });
});

describe("moveToSavings", () => {
  beforeEach(resetDb);

  it("creates the counterpart on the Savings account and links a confirmed pair (outflow)", async () => {
    const { user, main, savings } = await setup();
    const [row] = await seed(user.id, main.id, [{ date: "2026-10-05", amountCents: -5000, label: "VIR LIVRET A" }]);

    const result = await moveToSavings(db, user.id, { transactionId: row, accountId: savings.id, withRule: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [created] = await db.select().from(transactions).where(eq(transactions.id, result.createdId));
    expect(created).toMatchObject({
      accountId: savings.id,
      amountCents: 5000,
      date: "2026-10-05",
      source: "franc",
      createdFromId: row,
      dedupeHash: `franc:${row}`,
      categoryId: null,
    });
    expect(created.reviewedAt).not.toBeNull();
    const [pair] = await db.select().from(transfers).where(eq(transfers.id, result.transferId));
    expect(pair).toMatchObject({ outTransactionId: row, inTransactionId: result.createdId, status: "confirmed" });
    expect(await countMovedRows(db, user.id)).toBe(1);
  });

  it("takes money back from savings (inflow): the created row is the outflow", async () => {
    const { user, main, savings } = await setup();
    const [row] = await seed(user.id, main.id, [{ date: "2026-10-05", amountCents: 3000 }]);
    const result = await moveToSavings(db, user.id, { transactionId: row, accountId: savings.id, withRule: false });
    if (!result.ok) throw new Error(result.error);
    const [pair] = await db.select().from(transfers).where(eq(transfers.id, result.transferId));
    expect(pair).toMatchObject({ outTransactionId: result.createdId, inTransactionId: row });
  });

  it("refuses bad moves with codes and changes nothing", async () => {
    const { user, main, savings } = await setup();
    const [free, zero, ignored, paired] = await seed(user.id, main.id, [
      { date: "2026-10-05", amountCents: -100 },
      { date: "2026-10-05", amountCents: 0 },
      { date: "2026-10-05", amountCents: -100 },
      { date: "2026-10-05", amountCents: -100 },
    ]);
    await db.update(transactions).set({ ignoredAt: new Date() }).where(eq(transactions.id, ignored));
    const [other] = await seed(user.id, main.id, [{ date: "2026-10-05", amountCents: 100 }]);
    const linked = await linkTransfer(db, user.id, paired, other);
    expect(linked.ok).toBe(false); // same account: only here to prove `alreadyLinked` below needs a real pair

    expect(await moveToSavings(db, user.id, { transactionId: zero, accountId: savings.id, withRule: false })).toEqual({ ok: false, error: "zero" });
    expect(await moveToSavings(db, user.id, { transactionId: ignored, accountId: savings.id, withRule: false })).toEqual({ ok: false, error: "ignored" });
    expect(await moveToSavings(db, user.id, { transactionId: free, accountId: main.id, withRule: false })).toEqual({ ok: false, error: "notSavings" });
    expect(await moveToSavings(db, user.id, { transactionId: crypto.randomUUID(), accountId: savings.id, withRule: false })).toEqual({ ok: false, error: "notFound" });

    const first = await moveToSavings(db, user.id, { transactionId: free, accountId: savings.id, withRule: false });
    expect(first.ok).toBe(true);
    expect(await moveToSavings(db, user.id, { transactionId: free, accountId: savings.id, withRule: false })).toEqual({ ok: false, error: "alreadyLinked" });
    if (first.ok) {
      expect(await moveToSavings(db, user.id, { transactionId: first.createdId, accountId: savings.id, withRule: false })).toEqual({ ok: false, error: "savingsSource" });
    }
    expect(await countMovedRows(db, user.id)).toBe(1);
  });

  it("is scoped by user: another user's row and account are refused", async () => {
    const { user, main, savings } = await setup();
    const [row] = await seed(user.id, main.id, [{ date: "2026-10-05", amountCents: -100 }]);
    const stranger = await createTestUser();
    await provisionUserDefaults(db, stranger.id);
    expect(await moveToSavings(db, stranger.id, { transactionId: row, accountId: savings.id, withRule: false })).toEqual({ ok: false, error: "notFound" });
    const [theirs] = await listAccounts(stranger.id);
    const [strangerRow] = await seed(stranger.id, theirs.id, [{ date: "2026-10-05", amountCents: -100 }]);
    expect(await moveToSavings(db, stranger.id, { transactionId: strangerRow, accountId: savings.id, withRule: false })).toEqual({ ok: false, error: "notSavings" });
  });

  it("a rule moves the earlier matching rows too, in one transaction, and Undo removes them all", async () => {
    const { user, main, savings } = await setup();
    const [a, b, c, other] = await seed(user.id, main.id, [
      { date: "2026-08-05", amountCents: -5000, label: "VIR LIVRET A 0508" },
      { date: "2026-09-05", amountCents: -5000, label: "VIR LIVRET A 0509" },
      { date: "2026-10-05", amountCents: -5000, label: "VIR LIVRET A 0510" },
      { date: "2026-10-06", amountCents: -2000, label: "CARREFOUR" },
    ]);
    const result = await moveToSavings(db, user.id, { transactionId: c, accountId: savings.id, withRule: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.ruleId).not.toBeNull();
    expect(result.pastMoved).toBe(2);
    expect(await countMovedRows(db, user.id)).toBe(3);
    for (const id of [a, b]) expect(await getTransferForTransaction(db, user.id, id)).not.toBeNull();
    expect(await getTransferForTransaction(db, user.id, other)).toBeNull();
    const [rule] = await listSavingsRules(db, user.id, savings.id);
    // The merchant key drops the "VIR " channel prefix, like rule suggestions do.
    expect(rule.pattern).toBe("LIVRET A");

    // A second identical rule is not stored again and moves nothing more.
    const [again] = await seed(user.id, main.id, [{ date: "2026-10-07", amountCents: -100, label: "VIR LIVRET A 0710" }]);
    const second = await moveToSavings(db, user.id, { transactionId: again, accountId: savings.id, withRule: true });
    if (!second.ok) throw new Error(second.error);
    expect(second.ruleId).toBeNull();

    const removed = await removeSavingsMove(db, user.id, { transferId: result.transferId, ruleId: result.ruleId! });
    expect(removed).toMatchObject({ ok: true, sourceId: c, accountId: savings.id });
    // The three rows of that action are gone, the separate move stays, the user's rows are untouched.
    expect(await countMovedRows(db, user.id)).toBe(1);
    expect(await listSavingsRules(db, user.id, savings.id)).toHaveLength(0);
    expect((await db.select().from(transactions).where(eq(transactions.accountId, main.id))).length).toBe(5);
  });
});

describe("removeSavingsMove and unlinkTransfer", () => {
  beforeEach(resetDb);

  it("removes only the created row; scoped by user", async () => {
    const { user, main, savings } = await setup();
    const [row] = await seed(user.id, main.id, [{ date: "2026-10-05", amountCents: -5000 }]);
    const result = await moveToSavings(db, user.id, { transactionId: row, accountId: savings.id, withRule: false });
    if (!result.ok) throw new Error(result.error);

    const stranger = await createTestUser();
    expect(await removeSavingsMove(db, stranger.id, { transferId: result.transferId })).toEqual({ ok: false, error: "notFound" });
    expect(await countMovedRows(db, user.id)).toBe(1);

    expect(await removeSavingsMove(db, user.id, { transferId: result.transferId })).toMatchObject({ ok: true, sourceId: row });
    expect(await countMovedRows(db, user.id)).toBe(0);
    expect((await db.select().from(transactions).where(eq(transactions.id, row))).length).toBe(1);
    expect(await getTransferForTransaction(db, user.id, row)).toBeNull();
  });

  it("unlinking a franC pair deletes the created row and stores no rejection", async () => {
    const { user, main, savings } = await setup();
    const [row] = await seed(user.id, main.id, [{ date: "2026-10-05", amountCents: -5000 }]);
    const result = await moveToSavings(db, user.id, { transactionId: row, accountId: savings.id, withRule: false });
    if (!result.ok) throw new Error(result.error);
    await unlinkTransfer(db, user.id, result.transferId);
    expect(await countMovedRows(db, user.id)).toBe(0);
    expect(await db.select().from(transferRejections)).toHaveLength(0);
  });

  it("undoing the source's import removes the created row and the pair", async () => {
    const { user, main, savings } = await setup();
    const [importRow] = await db.insert(imports).values({ userId: user.id, accountId: main.id, filename: "y.csv" }).returning();
    const [row] = await db
      .insert(transactions)
      .values({ userId: user.id, accountId: main.id, importId: importRow.id, date: "2026-10-05", amountCents: -5000, dedupeHash: "undo1", occurrenceIndex: 0 })
      .returning({ id: transactions.id });
    await moveToSavings(db, user.id, { transactionId: row.id, accountId: savings.id, withRule: false });
    await undoImport(db, user.id, importRow.id);
    expect(await countMovedRows(db, user.id)).toBe(0);
    expect(await db.select().from(transfers)).toHaveLength(0);
  });
});

describe("hidden franc import", () => {
  beforeEach(resetDb);

  it("never shows in import history, counts or last-used account", async () => {
    const { user, main, savings } = await setup();
    const [row] = await seed(user.id, main.id, [{ date: "2026-10-05", amountCents: -5000 }]);
    await moveToSavings(db, user.id, { transactionId: row, accountId: savings.id, withRule: false });

    expect((await listImports(db, user.id)).map((i) => i.kind)).toEqual(["csv"]);
    const stats = await listAccountsWithStats(db, user.id);
    const livret = stats.find((s) => s.id === savings.id)!;
    expect(livret).toMatchObject({ savings: true, importCount: 0, lastImportAt: null, moveCount: 1 });
    expect(await getLastUsedAccountId(db, user.id)).toBe(main.id);
  });

  it("deleting a Savings account is allowed; the last current account is still kept", async () => {
    const { user, main, savings } = await setup();
    expect(await deleteAccount(db, user.id, main.id)).toEqual({ ok: false, error: "lastAccount" });
    expect(await deleteAccount(db, user.id, savings.id)).toMatchObject({ ok: true });
  });
});

describe("applySavingsRules", () => {
  beforeEach(resetDb);

  it("moves rows inserted after the rule, never older ones, and is idempotent", async () => {
    const { user, main, savings } = await setup();
    const [old] = await seed(user.id, main.id, [{ date: "2026-09-05", amountCents: -5000, label: "VIR LIVRET A 0509" }]);
    await db.insert(savingsRules).values({ userId: user.id, accountId: savings.id, pattern: "VIR LIVRET A", createdAt: new Date(Date.now() + 1000) });
    // Backdate the old row so it predates the rule.
    await db.update(transactions).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(transactions.id, old));

    const [fresh, unrelated] = await seed(user.id, main.id, [
      { date: "2026-10-05", amountCents: -5000, label: "VIR LIVRET A 0510" },
      { date: "2026-10-05", amountCents: -100, label: "CARREFOUR" },
    ]);
    await db.update(transactions).set({ createdAt: new Date(Date.now() + 5000) }).where(eq(transactions.id, fresh));

    expect(await applySavingsRules(db, user.id)).toBe(1);
    expect(await getTransferForTransaction(db, user.id, fresh)).not.toBeNull();
    expect(await getTransferForTransaction(db, user.id, old)).toBeNull();
    expect(await getTransferForTransaction(db, user.id, unrelated)).toBeNull();
    expect(await applySavingsRules(db, user.id)).toBe(0);
  });

  it("matches on the merchant name too and moves inflows back", async () => {
    const { user, main, savings } = await setup();
    const [merchant] = await db.insert(merchants).values({ userId: user.id, name: "Livret A" }).returning();
    await db.insert(savingsRules).values({ userId: user.id, accountId: savings.id, pattern: "Livret A", createdAt: new Date(Date.now() - 60_000) });
    const [out, back] = await seed(user.id, main.id, [
      { date: "2026-10-05", amountCents: -5000, label: "ZZZ 1", merchantId: merchant.id },
      { date: "2026-10-06", amountCents: 2000, label: "ZZZ 2", merchantId: merchant.id },
    ]);
    expect(await applySavingsRules(db, user.id)).toBe(2);
    for (const id of [out, back]) expect(await getTransferForTransaction(db, user.id, id)).not.toBeNull();
  });

  it("never touches another user's rows", async () => {
    const { user, savings } = await setup();
    await db.insert(savingsRules).values({ userId: user.id, accountId: savings.id, pattern: "VIR", createdAt: new Date(Date.now() - 60_000) });
    const stranger = await createTestUser();
    await provisionUserDefaults(db, stranger.id);
    const [theirs] = await listAccounts(stranger.id);
    const [row] = await seed(stranger.id, theirs.id, [{ date: "2026-10-05", amountCents: -5000, label: "VIR LIVRET A" }]);
    expect(await applySavingsRules(db, stranger.id)).toBe(0);
    expect(await applySavingsRules(db, user.id)).toBe(0);
    expect(await getTransferForTransaction(db, stranger.id, row)).toBeNull();
  });
});

describe("savings rules CRUD", () => {
  beforeEach(resetDb);

  it("deletes and restores a rule, scoped by user", async () => {
    const { user, savings } = await setup();
    await db.insert(savingsRules).values({ userId: user.id, accountId: savings.id, pattern: "VIR LIVRET A" });
    const [rule] = await listSavingsRules(db, user.id, savings.id);
    const stranger = await createTestUser();
    expect(await deleteSavingsRule(db, stranger.id, rule.id)).toBeNull();
    expect(await deleteSavingsRule(db, user.id, rule.id)).toMatchObject({ pattern: "VIR LIVRET A" });
    expect(await restoreSavingsRule(db, stranger.id, { accountId: savings.id, pattern: "VIR LIVRET A" })).toBe(false);
    expect(await restoreSavingsRule(db, user.id, { accountId: savings.id, pattern: "VIR LIVRET A" })).toBe(true);
    expect(await listSavingsRules(db, user.id, savings.id)).toHaveLength(1);
  });
});

describe("getSavedByMonth", () => {
  beforeEach(resetDb);

  it("counts money into savings, subtracts money back, and honours the account scope", async () => {
    const { user, main, savings } = await setup();
    const [put, back, plain] = await seed(user.id, main.id, [
      { date: "2026-10-05", amountCents: -5000 },
      { date: "2026-10-20", amountCents: 1500 },
      { date: "2026-10-21", amountCents: -999 },
    ]);
    await moveToSavings(db, user.id, { transactionId: put, accountId: savings.id, withRule: false });
    await moveToSavings(db, user.id, { transactionId: back, accountId: savings.id, withRule: false });

    expect(await getSavedByMonth(db, user.id, OCT)).toEqual(new Map([["2026-10", 3500]]));
    expect(await getSavedByMonth(db, user.id, OCT, { accountId: savings.id })).toEqual(new Map([["2026-10", 3500]]));
    expect(await getSavedByMonth(db, user.id, { from: "2026-11-01", to: "2026-11-30" })).toEqual(new Map());
    expect((await getSavedByMonth(db, user.id, OCT, { accountId: crypto.randomUUID() })).size).toBe(0);
    expect(plain).toBeDefined();
  });

  it("counts an imported pair between a current and a Savings account, not between two current accounts", async () => {
    const { user, main, savings } = await setup();
    const joint = await createAccount(db, user.id, "Joint");
    if (!joint.ok) throw new Error("createAccount failed");
    const [out1, out2] = await seed(user.id, main.id, [
      { date: "2026-10-03", amountCents: -4000 },
      { date: "2026-10-04", amountCents: -700 },
    ]);
    const [in1] = await seed(user.id, savings.id, [{ date: "2026-10-03", amountCents: 4000 }]);
    const [in2] = await seed(user.id, joint.account.id, [{ date: "2026-10-04", amountCents: 700 }]);
    expect((await linkTransfer(db, user.id, out1, in1)).ok).toBe(true);
    expect((await linkTransfer(db, user.id, out2, in2)).ok).toBe(true);
    expect(await getSavedByMonth(db, user.id, OCT)).toEqual(new Map([["2026-10", 4000]]));
  });

  it("leaves out a pair with an ignored leg", async () => {
    const { user, main, savings } = await setup();
    const [row] = await seed(user.id, main.id, [{ date: "2026-10-05", amountCents: -5000 }]);
    await moveToSavings(db, user.id, { transactionId: row, accountId: savings.id, withRule: false });
    await db.update(transactions).set({ ignoredAt: new Date() }).where(eq(transactions.id, row));
    expect((await getSavedByMonth(db, user.id, OCT)).size).toBe(0);
  });
});

describe("transfer candidates", () => {
  beforeEach(resetDb);

  it("never offers a row on a Savings account for a hand link", async () => {
    const { user, main, savings } = await setup();
    const [out] = await seed(user.id, main.id, [{ date: "2026-10-05", amountCents: -5000 }]);
    await seed(user.id, savings.id, [{ date: "2026-10-05", amountCents: 5000 }]);
    expect(await listTransferCandidates(db, user.id, out)).toEqual([]);
  });
});

describe("recurring detection keeps savings legs", () => {
  beforeEach(resetDb);

  it("a monthly standing order moved to savings stays a regular payment on the current account", async () => {
    const { user, main, savings } = await setup();
    const ids = await seed(
      user.id,
      main.id,
      ["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"].map((date) => ({ date, amountCents: -5000, label: "VIR LIVRET A" })),
    );
    await refreshRecurring(db, user.id);
    const before = await db.select().from(recurring).where(eq(recurring.userId, user.id));
    expect(before).toHaveLength(1);

    for (const id of ids) await moveToSavings(db, user.id, { transactionId: id, accountId: savings.id, withRule: false });
    await refreshTransfers(db, user.id);
    await refreshRecurring(db, user.id);
    const after = await db.select().from(recurring).where(eq(recurring.userId, user.id));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    // Only the current-account legs feed it: the created rows on the Savings account don't.
    const linked = await db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.userId, user.id), eq(transactions.recurringId, after[0].id)));
    expect(linked.map((l) => l.id).sort()).toEqual([...ids].sort());
  });
});

describe("goals on a move (Slice 55)", () => {
  beforeEach(resetDb);

  async function withGoal(name = "Car") {
    const ctx = await setup();
    await setAccountBalance(db, ctx.user.id, ctx.savings.id, { startingBalanceCents: 1_000_000, startingBalanceDate: "2026-09-01", thresholdCents: 0 });
    const goal = await createGoal(
      db,
      ctx.user.id,
      { name, targetCents: 500_000, targetDate: null, icon: null, source: { kind: "account", accountId: ctx.savings.id } },
      "2026-10-01",
    );
    if (!goal.ok) throw new Error(goal.error);
    return { ...ctx, goalId: goal.id };
  }

  const entriesOf = async (goalId: string) =>
    (await db.select().from(savingsGoalContributions).where(eq(savingsGoalContributions.goalId, goalId))).map((e) => e.amountCents);

  it("tags the moved row with a goal: the goal holds the created row's amount", async () => {
    const { user, main, savings, goalId } = await withGoal();
    const [row] = await seed(user.id, main.id, [{ date: "2026-10-05", amountCents: -5000 }]);
    const moved = await moveToSavings(db, user.id, { transactionId: row, accountId: savings.id, goalId, withRule: false });
    if (!moved.ok) throw new Error(moved.error);

    const [entry] = await db.select().from(savingsGoalContributions).where(eq(savingsGoalContributions.goalId, goalId));
    expect(entry).toMatchObject({ amountCents: 5000, transactionId: moved.createdId });
    expect((await getTransferForTransaction(db, user.id, row))?.goal?.name).toBe("Car");

    // Undo removes the entry with the created row, and says which goal it was.
    expect(await removeSavingsMove(db, user.id, { transferId: moved.transferId })).toMatchObject({ ok: true, goalId });
    expect(await entriesOf(goalId)).toEqual([]);
  });

  it("refuses money out of a goal that holds too little, and a goal of another account or user", async () => {
    const { user, main, savings, goalId } = await withGoal();
    const [inflow] = await seed(user.id, main.id, [{ date: "2026-10-05", amountCents: 3000 }]);
    expect(await moveToSavings(db, user.id, { transactionId: inflow, accountId: savings.id, goalId, withRule: false })).toEqual({ ok: false, error: "exceedsSaved" });
    expect(await getTransferForTransaction(db, user.id, inflow)).toBeNull();

    await assignToGoal(db, user.id, goalId, { amountCents: 3000, date: "2026-10-05" });
    expect(await moveToSavings(db, user.id, { transactionId: inflow, accountId: savings.id, goalId, withRule: false })).toMatchObject({ ok: true });
    expect(await entriesOf(goalId)).toEqual([3000, -3000]);

    const [other] = await seed(user.id, main.id, [{ date: "2026-10-06", amountCents: -100 }]);
    const stranger = await withGoal("Theirs");
    expect(await moveToSavings(db, user.id, { transactionId: other, accountId: savings.id, goalId: stranger.goalId, withRule: false })).toEqual({ ok: false, error: "goalNotFound" });
  });

  it("a rule carries the goal for money in, past and future, and never for money out", async () => {
    const { user, main, savings, goalId } = await withGoal();
    const [first, past, taken] = await seed(user.id, main.id, [
      { date: "2026-10-05", amountCents: -5000, label: "VIR LIVRET A 1005" },
      { date: "2026-09-05", amountCents: -5000, label: "VIR LIVRET A 0905" },
      { date: "2026-09-20", amountCents: 2000, label: "VIR LIVRET A RETOUR" },
    ]);
    // Money back first needs something in the goal; the rule itself leaves money out unassigned.
    const moved = await moveToSavings(db, user.id, { transactionId: first, accountId: savings.id, goalId, withRule: true });
    if (!moved.ok) throw new Error(moved.error);
    expect(moved.pastMoved).toBe(2);
    const [rule] = await db.select().from(savingsRules).where(eq(savingsRules.userId, user.id));
    expect(rule.goalId).toBe(goalId);
    expect((await entriesOf(goalId)).sort()).toEqual([5000, 5000]);
    expect(await getTransferForTransaction(db, user.id, taken)).not.toBeNull();
    expect(past).toBeDefined();

    const [later] = await seed(user.id, main.id, [{ date: "2026-10-20", amountCents: -7000, label: "VIR LIVRET A 1020" }]);
    await db.update(transactions).set({ createdAt: new Date(Date.now() + 5000) }).where(eq(transactions.id, later));
    expect(await applySavingsRules(db, user.id)).toBe(1);
    expect((await entriesOf(goalId)).sort()).toEqual([5000, 5000, 7000]);
    expect((await listGoals(db, user.id))[0].savedCents).toBe(17_000);
  });

  it("changes, clears and refuses the goal of an existing move", async () => {
    const { user, main, savings, goalId } = await withGoal();
    const second = await createGoal(db, user.id, { name: "Trip", targetCents: 100_000, targetDate: null, icon: null, source: { kind: "account", accountId: savings.id } }, "2026-10-01");
    if (!second.ok) throw new Error(second.error);
    const [row] = await seed(user.id, main.id, [{ date: "2026-10-05", amountCents: -5000 }]);
    const moved = await moveToSavings(db, user.id, { transactionId: row, accountId: savings.id, goalId: null, withRule: false });
    if (!moved.ok) throw new Error(moved.error);

    expect(await setMoveGoal(db, user.id, { transferId: moved.transferId, goalId })).toEqual({ ok: true });
    expect(await entriesOf(goalId)).toEqual([5000]);
    expect(await setMoveGoal(db, user.id, { transferId: moved.transferId, goalId: second.id })).toEqual({ ok: true });
    expect(await entriesOf(goalId)).toEqual([]);
    expect(await entriesOf(second.id)).toEqual([5000]);
    expect(await setMoveGoal(db, user.id, { transferId: moved.transferId, goalId: null })).toEqual({ ok: true });
    expect(await entriesOf(second.id)).toEqual([]);

    const stranger = await createTestUser();
    expect(await setMoveGoal(db, stranger.id, { transferId: moved.transferId, goalId: null })).toEqual({ ok: false, error: "notFound" });
    expect(await setMoveGoal(db, user.id, { transferId: moved.transferId, goalId: "00000000-0000-4000-8000-000000000000" })).toEqual({ ok: false, error: "goalNotFound" });
  });
});

