// @vitest-environment node
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { balanceCheckpoints, imports, savingsGoalContributions, savingsRules, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import type { GoalInput } from "../../lib/goals/input";
import { createAccount, deleteAccount, listAccounts } from "./accounts";
import { getAccountBalances, setAccountBalance } from "./balance";
import {
  addContribution,
  assignToGoal,
  createGoal,
  deleteContribution,
  deleteGoal,
  goalsByAccount,
  listGoalMoney,
  listGoals,
  listRecentContributions,
  moveBetweenGoals,
  restoreGoal,
  updateGoal,
} from "./goals";
import { bankConnectionStore, listBankConnections, saveBankLinks } from "./bank-connections";
import { provisionUserDefaults } from "./provision";

let hashCounter = 0;
const TODAY = "2026-09-30";

async function seed(userId: string, accountId: string, rows: { date: string; amountCents: number }[]) {
  const [imp] = await db
    .insert(imports)
    .values({ userId, accountId, filename: "x.csv", rowsTotal: rows.length, rowsError: 0 })
    .returning();
  await db.insert(transactions).values(
    rows.map((r) => ({
      userId,
      accountId,
      importId: imp.id,
      date: r.date,
      amountCents: r.amountCents,
      labelRaw: "L",
      labelNormalized: "L",
      labelDisplay: "L",
      dedupeHash: `goal${hashCounter++}`,
      occurrenceIndex: 0,
    })),
  );
}

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [main] = await listAccounts(user.id);
  const savings = await createAccount(db, user.id, "Livret A");
  if (!savings.ok) throw new Error(savings.error);
  return { user, main, savings: savings.account };
}

const manual = (name = "Car"): GoalInput => ({
  name,
  targetCents: 300_000,
  targetDate: "2027-06-15",
  icon: "🚗",
  source: { kind: "manual" },
});

async function create(userId: string, input: GoalInput): Promise<string> {
  const result = await createGoal(db, userId, input, TODAY);
  if (!result.ok) throw new Error(result.error);
  return result.id;
}

describe("savings goals queries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reads a manual goal's progress from its contributions", async () => {
    const { user } = await setup();
    const id = await create(user.id, manual());
    expect(await addContribution(db, user.id, id, { amountCents: 50_000, date: "2026-09-01" })).toEqual({ ok: true });
    expect(await addContribution(db, user.id, id, { amountCents: -10_000, date: "2026-09-20" })).toEqual({ ok: true });

    const [goal] = await listGoals(db, user.id);
    expect(goal).toMatchObject({ id, name: "Car", savedCents: 40_000, accountId: null, startCents: 0, startDate: TODAY });
    const recent = await listRecentContributions(db, user.id);
    expect(recent.get(id)?.map((c) => c.amountCents)).toEqual([-10_000, 50_000]);
  });

  it("refuses taking out more than a manual goal holds", async () => {
    const { user } = await setup();
    const id = await create(user.id, manual());
    await addContribution(db, user.id, id, { amountCents: 5_000, date: TODAY });
    expect(await addContribution(db, user.id, id, { amountCents: -5_001, date: TODAY })).toEqual({
      ok: false,
      error: "exceedsSaved",
    });
  });

  it("lets several goals share one account and holds each goal's own entries", async () => {
    const { user, savings } = await setup();
    await setAccountBalance(db, user.id, savings.id, {
      startingBalanceCents: 100_000,
      startingBalanceDate: "2026-09-01",
      thresholdCents: 0,
    });
    const car = await create(user.id, { ...manual("Car"), source: { kind: "account", accountId: savings.id } });
    const trip = await create(user.id, { ...manual("Trip"), source: { kind: "account", accountId: savings.id } });
    expect(await assignToGoal(db, user.id, car, { amountCents: 30_000, date: TODAY })).toEqual({ ok: true });
    expect(await assignToGoal(db, user.id, trip, { amountCents: 20_000, date: TODAY })).toEqual({ ok: true });

    const { goals, money } = await listGoalMoney(db, user.id);
    expect(goals.map((g) => [g.name, g.savedCents, g.accountName])).toEqual([
      ["Car", 30_000, "Livret A"],
      ["Trip", 20_000, "Livret A"],
    ]);
    expect(money.get(savings.id)).toEqual({ accountId: savings.id, balanceCents: 100_000, assignedCents: 50_000, notAssignedCents: 50_000 });
    expect(await goalsByAccount(db, user.id)).toEqual(new Map([[savings.id, ["Car", "Trip"]]]));
    // A new account goal holds nothing and its plan starts from 0.
    expect(goals[0]).toMatchObject({ startCents: 0, startDate: TODAY });
    // Manual add is for goals tracked by hand only.
    expect(await addContribution(db, user.id, car, { amountCents: 100, date: TODAY })).toEqual({ ok: false, error: "notManual" });
  });

  it("limits assigning to what is not assigned and taking back to what the goal holds", async () => {
    const { user, savings } = await setup();
    const noBalance = await create(user.id, { ...manual("Car"), source: { kind: "account", accountId: savings.id } });
    expect(await assignToGoal(db, user.id, noBalance, { amountCents: 100, date: TODAY })).toEqual({ ok: false, error: "noBalance" });

    await setAccountBalance(db, user.id, savings.id, { startingBalanceCents: 60_000, startingBalanceDate: "2026-09-01", thresholdCents: 0 });
    const trip = await create(user.id, { ...manual("Trip"), source: { kind: "account", accountId: savings.id } });
    expect(await assignToGoal(db, user.id, noBalance, { amountCents: 40_000, date: TODAY })).toEqual({ ok: true });
    expect(await assignToGoal(db, user.id, trip, { amountCents: 20_001, date: TODAY })).toEqual({ ok: false, error: "exceedsNotAssigned" });
    expect(await assignToGoal(db, user.id, trip, { amountCents: 20_000, date: TODAY })).toEqual({ ok: true });
    expect(await assignToGoal(db, user.id, trip, { amountCents: -20_001, date: TODAY })).toEqual({ ok: false, error: "exceedsSaved" });
    expect(await assignToGoal(db, user.id, trip, { amountCents: -5_000, date: TODAY })).toEqual({ ok: true });

    const manualGoal = await create(user.id, manual("Bike"));
    expect(await assignToGoal(db, user.id, manualGoal, { amountCents: 100, date: TODAY })).toEqual({ ok: false, error: "notAccount" });
  });

  it("moves money between goals of one account only", async () => {
    const { user, main, savings } = await setup();
    await setAccountBalance(db, user.id, savings.id, { startingBalanceCents: 100_000, startingBalanceDate: "2026-09-01", thresholdCents: 0 });
    const car = await create(user.id, { ...manual("Car"), source: { kind: "account", accountId: savings.id } });
    const trip = await create(user.id, { ...manual("Trip"), source: { kind: "account", accountId: savings.id } });
    const other = await create(user.id, { ...manual("Other"), source: { kind: "account", accountId: main.id } });
    await assignToGoal(db, user.id, car, { amountCents: 30_000, date: TODAY });

    expect(await moveBetweenGoals(db, user.id, { fromGoalId: car, toGoalId: trip, amountCents: 30_001, date: TODAY })).toEqual({ ok: false, error: "exceedsSaved" });
    expect(await moveBetweenGoals(db, user.id, { fromGoalId: car, toGoalId: other, amountCents: 100, date: TODAY })).toEqual({ ok: false, error: "notSameAccount" });
    expect(await moveBetweenGoals(db, user.id, { fromGoalId: car, toGoalId: car, amountCents: 100, date: TODAY })).toEqual({ ok: false, error: "notSameAccount" });
    expect(await moveBetweenGoals(db, user.id, { fromGoalId: car, toGoalId: trip, amountCents: 10_000, date: TODAY })).toEqual({ ok: true });
    expect((await listGoals(db, user.id)).map((g) => g.savedCents)).toEqual([20_000, 10_000, 0]);
  });

  it("changes a goal's account only while it holds nothing, and clears the rules that pointed at it", async () => {
    const { user, main, savings } = await setup();
    await setAccountBalance(db, user.id, savings.id, { startingBalanceCents: 100_000, startingBalanceDate: "2026-09-01", thresholdCents: 0 });
    const id = await create(user.id, { ...manual("Car"), source: { kind: "account", accountId: savings.id } });
    await assignToGoal(db, user.id, id, { amountCents: 10_000, date: TODAY });
    const toMain = { ...manual("Car"), source: { kind: "account", accountId: main.id } } satisfies GoalInput;
    expect(await updateGoal(db, user.id, id, toMain, TODAY)).toEqual({ ok: false, error: "notEmpty" });

    await assignToGoal(db, user.id, id, { amountCents: -10_000, date: TODAY });
    const [rule] = await db.insert(savingsRules).values({ userId: user.id, accountId: savings.id, goalId: id, pattern: "LIVRET" }).returning();
    expect(await updateGoal(db, user.id, id, toMain, TODAY)).toEqual({ ok: true, id });
    expect(await db.select().from(savingsGoalContributions).where(eq(savingsGoalContributions.goalId, id))).toEqual([]);
    expect((await db.select().from(savingsRules).where(eq(savingsRules.id, rule.id)))[0].goalId).toBeNull();
    expect((await listGoals(db, user.id))[0]).toMatchObject({ accountId: main.id, startDate: TODAY });
  });

  it("refuses removing an entry that would leave a goal below zero", async () => {
    const { user, savings } = await setup();
    await setAccountBalance(db, user.id, savings.id, { startingBalanceCents: 100_000, startingBalanceDate: "2026-09-01", thresholdCents: 0 });
    const id = await create(user.id, { ...manual("Car"), source: { kind: "account", accountId: savings.id } });
    await assignToGoal(db, user.id, id, { amountCents: 10_000, date: TODAY });
    await assignToGoal(db, user.id, id, { amountCents: -4_000, date: TODAY });
    const entries = (await listRecentContributions(db, user.id)).get(id) ?? [];
    const assigned = entries.find((e) => e.amountCents === 10_000)!;
    expect(await deleteContribution(db, user.id, assigned.id)).toEqual({ ok: false, error: "exceedsSaved" });
    const taken = entries.find((e) => e.amountCents === -4_000)!;
    expect(await deleteContribution(db, user.id, taken.id)).toEqual({ ok: true });
  });

  it("allows unique names ignoring case", async () => {
    const { user } = await setup();
    await create(user.id, manual());
    expect(await createGoal(db, user.id, manual("CAR"), TODAY)).toEqual({ ok: false, error: "nameTaken" });
  });

  it("restarts the plan when the target changes, not on a rename", async () => {
    const { user } = await setup();
    const id = await create(user.id, manual());
    await addContribution(db, user.id, id, { amountCents: 30_000, date: TODAY });

    await updateGoal(db, user.id, id, { ...manual("New car") }, "2026-10-15");
    expect((await listGoals(db, user.id))[0]).toMatchObject({ name: "New car", startCents: 0, startDate: TODAY });

    await updateGoal(db, user.id, id, { ...manual("New car"), targetCents: 400_000 }, "2026-10-15");
    expect((await listGoals(db, user.id))[0]).toMatchObject({ startCents: 30_000, startDate: "2026-10-15" });
  });

  it("turns an account goal into a manual one when the account is deleted", async () => {
    const { user, savings } = await setup();
    await create(user.id, { ...manual(), source: { kind: "account", accountId: savings.id } });
    await deleteAccount(db, user.id, savings.id);
    const [goal] = await listGoals(db, user.id);
    expect(goal).toMatchObject({ accountId: null, savedCents: 0 });
  });

  it("keeps a goal's money when its account is deleted", async () => {
    const { user, savings } = await setup();
    const id = await create(user.id, { ...manual(), source: { kind: "account", accountId: savings.id } });
    const [imp] = await db.insert(imports).values({ userId: user.id, accountId: savings.id, filename: "franc", kind: "franc", rowsTotal: 0, rowsError: 0 }).returning();
    const [row] = await db
      .insert(transactions)
      .values({ userId: user.id, accountId: savings.id, importId: imp.id, date: TODAY, amountCents: 5_000, labelRaw: "L", labelNormalized: "L", labelDisplay: "L", dedupeHash: "keep1", occurrenceIndex: 0, source: "franc" })
      .returning();
    await db.insert(savingsGoalContributions).values({ userId: user.id, goalId: id, transactionId: row.id, date: TODAY, amountCents: 5_000 });

    await deleteAccount(db, user.id, savings.id);
    expect((await listGoals(db, user.id))[0]).toMatchObject({ accountId: null, savedCents: 5_000 });
  });

  it("never reads or writes another user's goals or accounts", async () => {
    const { user } = await setup();
    const other = await setup();
    const id = await create(user.id, manual());

    expect(await listGoals(db, other.user.id)).toEqual([]);
    expect(await updateGoal(db, other.user.id, id, manual(), TODAY)).toEqual({ ok: false, error: "notFound" });
    expect(await addContribution(db, other.user.id, id, { amountCents: 100, date: TODAY })).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await deleteGoal(db, other.user.id, id)).toEqual({ ok: false, error: "notFound" });
    expect(
      await createGoal(db, user.id, { ...manual("Bike"), source: { kind: "account", accountId: other.savings.id } }, TODAY),
    ).toEqual({ ok: false, error: "accountNotFound" });

    await addContribution(db, user.id, id, { amountCents: 100, date: TODAY });
    const [entry] = (await listRecentContributions(db, user.id)).get(id) ?? [];
    expect(await deleteContribution(db, other.user.id, entry.id)).toEqual({ ok: false, error: "notFound" });
    expect(await deleteContribution(db, user.id, entry.id)).toEqual({ ok: true });
    expect(await deleteGoal(db, user.id, id)).toMatchObject({ ok: true });
  });

  it("restores a deleted manual goal with the same ids and its contributions", async () => {
    const { user } = await setup();
    const id = await create(user.id, manual());
    await addContribution(db, user.id, id, { amountCents: 50_000, date: "2026-09-01" });
    await addContribution(db, user.id, id, { amountCents: -10_000, date: "2026-09-20" });
    const [before] = await listGoals(db, user.id);
    const entriesBefore = (await listRecentContributions(db, user.id)).get(id);

    const deleted = await deleteGoal(db, user.id, id);
    if (!deleted.ok) throw new Error(deleted.error);
    expect(deleted.snapshot.contributions).toHaveLength(2);
    expect(await listGoals(db, user.id)).toEqual([]);

    expect(await restoreGoal(db, user.id, deleted.snapshot)).toEqual({ ok: true, id });
    expect(await listGoals(db, user.id)).toEqual([before]);
    expect((await listRecentContributions(db, user.id)).get(id)).toEqual(entriesBefore);
  });

  it("refuses to restore onto a taken name, a missing account, or someone else's id", async () => {
    const { user, savings } = await setup();
    const other = await setup();
    const manualId = await create(user.id, manual("Car"));
    const accountId = await create(user.id, { ...manual("Trip"), source: { kind: "account", accountId: savings.id } });
    const manualSnap = await deleteGoal(db, user.id, manualId);
    const accountSnap = await deleteGoal(db, user.id, accountId);
    if (!manualSnap.ok || !accountSnap.ok) throw new Error("delete failed");

    await create(user.id, manual("car"));
    expect(await restoreGoal(db, user.id, manualSnap.snapshot)).toEqual({ ok: false, error: "nameTaken" });

    // Another user doesn't own the account.
    expect(await restoreGoal(db, other.user.id, accountSnap.snapshot)).toEqual({ ok: false, error: "accountNotFound" });
    expect(await listGoals(db, other.user.id)).toEqual([]);

    // The id is free for the owner only once; a second restore is refused and adds nothing.
    await deleteGoal(db, user.id, (await listGoals(db, user.id))[0].id);
    const again = await restoreGoal(db, other.user.id, { ...manualSnap.snapshot, goal: { ...manualSnap.snapshot.goal, name: "Mine" } });
    expect(again).toEqual({ ok: true, id: manualId });
    expect(await restoreGoal(db, user.id, { ...manualSnap.snapshot, goal: { ...manualSnap.snapshot.goal, name: "Mine too" } })).toEqual({
      ok: false,
      error: "notFound",
    });
  });

  it("restores a deleted account goal with its moved-row entries and rules, skipping rows that are gone", async () => {
    const { user, savings } = await setup();
    const id = await create(user.id, { ...manual(), source: { kind: "account", accountId: savings.id } });
    const [imp] = await db.insert(imports).values({ userId: user.id, accountId: savings.id, filename: "franc", kind: "franc", rowsTotal: 0, rowsError: 0 }).returning();
    const rows = await db
      .insert(transactions)
      .values(
        ["a", "b"].map((k) => ({ userId: user.id, accountId: savings.id, importId: imp.id, date: TODAY, amountCents: 1_000, labelRaw: k, labelNormalized: k, labelDisplay: k, dedupeHash: `r${k}`, occurrenceIndex: 0, source: "franc" as const })),
      )
      .returning();
    for (const r of rows) await db.insert(savingsGoalContributions).values({ userId: user.id, goalId: id, transactionId: r.id, date: TODAY, amountCents: 1_000 });
    const [rule] = await db.insert(savingsRules).values({ userId: user.id, accountId: savings.id, goalId: id, pattern: "LIVRET" }).returning();

    const deleted = await deleteGoal(db, user.id, id);
    if (!deleted.ok) throw new Error(deleted.error);
    expect(deleted.snapshot.ruleIds).toEqual([rule.id]);
    expect((await db.select().from(savingsRules).where(eq(savingsRules.id, rule.id)))[0].goalId).toBeNull();
    // One of the moved rows disappeared meanwhile.
    await db.delete(transactions).where(eq(transactions.id, rows[1].id));

    expect(await restoreGoal(db, user.id, deleted.snapshot)).toEqual({ ok: true, id });
    expect((await listGoals(db, user.id))[0].savedCents).toBe(1_000);
    expect((await db.select().from(savingsRules).where(eq(savingsRules.id, rule.id)))[0].goalId).toBe(id);
  });

  describe("migration 0034 backfill", () => {
    // The data step of the migration, run on its own against rows that look like production's.
    const backfill = () => {
      const file = readFileSync("src/db/migrations/0034_goal_money.sql", "utf8");
      return sql.raw(file.slice(file.indexOf("-- Slice 55:")));
    };

    it("gives each account goal one entry equal to its balance and leaves the rest alone", async () => {
      const { user, main, savings } = await setup();
      // Manual starting balance plus a later row.
      await setAccountBalance(db, user.id, savings.id, { startingBalanceCents: 100_000, startingBalanceDate: "2026-09-01", thresholdCents: 0 });
      await seed(user.id, savings.id, [{ date: "2026-09-15", amountCents: 20_000 }]);
      const withBalance = await create(user.id, { ...manual("Car"), source: { kind: "account", accountId: savings.id } });
      // An account without a balance, and a goal tracked by hand.
      const noBalance = await create(user.id, { ...manual("Trip"), source: { kind: "account", accountId: main.id } });
      const byHand = await create(user.id, manual("Bike"));
      await addContribution(db, user.id, byHand, { amountCents: 7_000, date: "2026-09-02" });

      await db.execute(backfill());

      const entries = async (goalId: string) => (await db.select().from(savingsGoalContributions).where(eq(savingsGoalContributions.goalId, goalId))).map((e) => [e.amountCents, e.transactionId]);
      const balance = (await getAccountBalances(db, user.id)).find((b) => b.id === savings.id)?.balanceCents;
      expect(balance).toBe(120_000);
      expect(await entries(withBalance)).toEqual([[120_000, null]]);
      expect(await entries(noBalance)).toEqual([]);
      expect(await entries(byHand)).toEqual([[7_000, null]]);
      const goals = await listGoals(db, user.id);
      expect(goals.find((g) => g.id === withBalance)?.savedCents).toBe(balance);
    });

    it("follows the bank's balance for a linked account", async () => {
      const { user, main } = await setup();
      const connections = bankConnectionStore(db);
      const until = new Date("2027-03-31T00:00:00Z");
      await connections.createPending(user.id, { aspspName: "Caisse d'Epargne", aspspCountry: "FR", authState: `s-${user.id}`, validUntil: until });
      const pending = await connections.findPendingByState(user.id, `s-${user.id}`);
      await connections.activate(user.id, pending!.id, {
        sessionId: "sess",
        validUntil: until,
        connectedAt: new Date("2026-10-02T10:00:00Z"),
        accounts: [{ bankAccountUid: "uid-1", displayName: "Compte", ibanLast4: "1234", currency: "EUR" }],
      });
      const [connection] = await listBankConnections(db, user.id);
      await saveBankLinks(db, user.id, connection.id, [{ linkId: connection.links[0].id, choice: { kind: "existing", accountId: main.id } }]);
      await db.insert(balanceCheckpoints).values({ userId: user.id, accountId: main.id, date: "2026-09-20", amountCents: 50_000, source: "bank" });
      await seed(user.id, main.id, [{ date: "2026-09-25", amountCents: -4_000 }, { date: "2026-09-10", amountCents: -999 }]);
      const goalId = await create(user.id, { ...manual("Car"), source: { kind: "account", accountId: main.id } });

      await db.execute(backfill());

      const balance = (await getAccountBalances(db, user.id)).find((b) => b.id === main.id)?.balanceCents;
      expect(balance).toBe(46_000);
      expect((await db.select().from(savingsGoalContributions).where(eq(savingsGoalContributions.goalId, goalId))).map((e) => e.amountCents)).toEqual([46_000]);
    });
  });
});
