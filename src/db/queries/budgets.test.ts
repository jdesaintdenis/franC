// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "../client";
import { categoryBudgets, imports, recurring, transactions, transfers } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { createAccount, listAccounts } from "./accounts";
import { getBudgetPresets, getBudgetProgress, listBudgets, removeBudget, restoreBudget, setBudget } from "./budgets";
import { createCategory, deleteCategory } from "./categories";
import { provisionUserDefaults } from "./provision";
import { saveSplit } from "./splits";
import { linkTransfer } from "./transfers";

let hashCounter = 0;

interface Row {
  date: string;
  amountCents: number;
  categoryId?: string | null;
  accountId?: string;
}

async function seed(userId: string, accountId: string, rows: Row[]): Promise<string[]> {
  const [imp] = await db
    .insert(imports)
    .values({ userId, accountId, filename: "x.csv", rowsTotal: rows.length, rowsError: 0 })
    .returning();
  const inserted = await db
    .insert(transactions)
    .values(
      rows.map((r) => ({
        userId,
        accountId: r.accountId ?? accountId,
        importId: imp.id,
        date: r.date,
        amountCents: r.amountCents,
        labelRaw: "L",
        labelNormalized: "L",
        labelDisplay: "L",
        categoryId: r.categoryId ?? null,
        dedupeHash: `b${hashCounter++}`,
        occurrenceIndex: 0,
      })),
    )
    .returning({ id: transactions.id });
  return inserted.map((r) => r.id);
}

async function makeCategory(userId: string, name: string, parentId?: string): Promise<string> {
  const created = await createCategory(db, userId, { name, color: "#112233", parentId: parentId ?? null });
  if (!created.ok) throw new Error(created.error);
  return created.category.id;
}

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [account] = await listAccounts(user.id);
  return { user, account };
}

const RANGE = { from: "2026-03-01", to: "2026-03-31" };

describe("budget CRUD", () => {
  beforeEach(resetDb);

  it("sets, updates and removes a budget", async () => {
    const { user } = await setup();
    const food = await makeCategory(user.id, "Food");

    expect(await setBudget(db, user.id, food, 40000)).toEqual({ ok: true });
    expect(await listBudgets(db, user.id)).toEqual([{ categoryId: food, amountCents: 40000, rollover: false }]);

    expect(await setBudget(db, user.id, food, 45050)).toEqual({ ok: true });
    expect(await listBudgets(db, user.id)).toEqual([{ categoryId: food, amountCents: 45050, rollover: false }]);

    await removeBudget(db, user.id, food);
    expect(await listBudgets(db, user.id)).toEqual([]);
    await removeBudget(db, user.id, food); // no-op
  });

  it("refuses another user's category and does not touch its budget", async () => {
    const a = await setup();
    const b = await setup();
    const catA = await makeCategory(a.user.id, "Food");
    await setBudget(db, a.user.id, catA, 1000);

    expect(await setBudget(db, b.user.id, catA, 9999)).toEqual({ ok: false, error: "not_found" });
    await removeBudget(db, b.user.id, catA);
    expect(await listBudgets(db, a.user.id)).toEqual([{ categoryId: catA, amountCents: 1000, rollover: false }]);
    expect(await listBudgets(db, b.user.id)).toEqual([]);
    expect(await db.select().from(categoryBudgets)).toHaveLength(1);
  });

  it("refuses an unknown category and a non-positive amount", async () => {
    const { user } = await setup();
    expect(await setBudget(db, user.id, "00000000-0000-4000-8000-000000000000", 100)).toEqual({
      ok: false,
      error: "not_found",
    });
    const food = await makeCategory(user.id, "Food");
    await expect(setBudget(db, user.id, food, 0)).rejects.toThrow();
  });
});

describe("getBudgetProgress", () => {
  beforeEach(resetDb);

  it("rolls subcategory spending up into a budgeted parent", async () => {
    const { user, account } = await setup();
    const housing = await makeCategory(user.id, "Housing");
    const rent = await makeCategory(user.id, "Rent", housing);
    const energy = await makeCategory(user.id, "Energy", housing);
    await seed(user.id, account.id, [
      { date: "2026-03-02", amountCents: -1000, categoryId: housing },
      { date: "2026-03-03", amountCents: -80000, categoryId: rent },
      { date: "2026-03-04", amountCents: -2500, categoryId: energy },
      { date: "2026-03-05", amountCents: -700, categoryId: null },
    ]);
    await setBudget(db, user.id, housing, 100000);
    await setBudget(db, user.id, rent, 80000);

    const rows = await getBudgetProgress(db, user.id, RANGE);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.categoryId === housing)).toMatchObject({
      name: "Housing",
      parentId: null,
      parentName: null,
      budgetCents: 100000,
      spentCents: 83500,
    });
    expect(rows.find((r) => r.categoryId === rent)).toMatchObject({
      parentId: housing,
      parentName: "Housing",
      budgetCents: 80000,
      spentCents: 80000,
    });
  });

  it("gives a standalone subcategory budget only its own spending", async () => {
    const { user, account } = await setup();
    const housing = await makeCategory(user.id, "Housing");
    const rent = await makeCategory(user.id, "Rent", housing);
    await seed(user.id, account.id, [
      { date: "2026-03-02", amountCents: -1000, categoryId: housing },
      { date: "2026-03-03", amountCents: -80000, categoryId: rent },
    ]);
    await setBudget(db, user.id, rent, 90000);
    const rows = await getBudgetProgress(db, user.id, RANGE);
    expect(rows).toEqual([expect.objectContaining({ categoryId: rent, spentCents: 80000 })]);
  });

  it("returns zero spent for a budget without transactions", async () => {
    const { user } = await setup();
    const food = await makeCategory(user.id, "Food");
    await setBudget(db, user.id, food, 5000);
    expect(await getBudgetProgress(db, user.id, RANGE)).toEqual([
      expect.objectContaining({ categoryId: food, spentCents: 0, budgetCents: 5000 }),
    ]);
  });

  it("counts outflows only: inflows and refunds never free budget", async () => {
    const { user, account } = await setup();
    const shop = await makeCategory(user.id, "Shopping");
    await seed(user.id, account.id, [
      { date: "2026-03-02", amountCents: -6000, categoryId: shop },
      { date: "2026-03-03", amountCents: 5000, categoryId: shop },
    ]);
    await setBudget(db, user.id, shop, 10000);
    const [row] = await getBudgetProgress(db, user.id, RANGE);
    expect(row.spentCents).toBe(6000);
  });

  it("counts all accounts and excludes internal transfers", async () => {
    const { user, account } = await setup();
    const created = await createAccount(db, user.id, "Savings");
    if (!created.ok) throw new Error("createAccount failed");
    const savings = created.account;
    const food = await makeCategory(user.id, "Food");
    const [out] = await seed(user.id, account.id, [{ date: "2026-03-10", amountCents: -5000, categoryId: food }]);
    const [inn] = await seed(user.id, savings.id, [{ date: "2026-03-10", amountCents: 5000 }]);
    await seed(user.id, savings.id, [{ date: "2026-03-11", amountCents: -300, categoryId: food }]);
    await setBudget(db, user.id, food, 10000);

    expect((await getBudgetProgress(db, user.id, RANGE))[0].spentCents).toBe(5300);
    const linked = await linkTransfer(db, user.id, out, inn);
    expect(linked.ok).toBe(true);
    expect((await getBudgetProgress(db, user.id, RANGE))[0].spentCents).toBe(300);
  });

  it("excludes other months and includes the boundary days", async () => {
    const { user, account } = await setup();
    const food = await makeCategory(user.id, "Food");
    await seed(user.id, account.id, [
      { date: "2026-02-28", amountCents: -100, categoryId: food },
      { date: "2026-03-01", amountCents: -200, categoryId: food },
      { date: "2026-03-31", amountCents: -400, categoryId: food },
      { date: "2026-04-01", amountCents: -800, categoryId: food },
    ]);
    await setBudget(db, user.id, food, 10000);
    expect((await getBudgetProgress(db, user.id, RANGE))[0].spentCents).toBe(600);
  });
});

describe("budgets and category deletion", () => {
  beforeEach(resetDb);

  it("drops a subcategory's budget when it is deleted with move-to-parent", async () => {
    const { user } = await setup();
    const housing = await makeCategory(user.id, "Housing");
    const rent = await makeCategory(user.id, "Rent", housing);
    await setBudget(db, user.id, housing, 100000);
    await setBudget(db, user.id, rent, 80000);

    const result = await deleteCategory(db, user.id, rent, "move_to_parent");
    expect(result.ok).toBe(true);
    expect(await listBudgets(db, user.id)).toEqual([{ categoryId: housing, amountCents: 100000, rollover: false }]);
  });

  it("keeps the children's budgets when a parent is deleted but its children are kept", async () => {
    const { user } = await setup();
    const housing = await makeCategory(user.id, "Housing");
    const rent = await makeCategory(user.id, "Rent", housing);
    await setBudget(db, user.id, housing, 100000);
    await setBudget(db, user.id, rent, 80000);

    const result = await deleteCategory(db, user.id, housing, "keep_subcategories");
    expect(result.ok).toBe(true);
    expect(await listBudgets(db, user.id)).toEqual([{ categoryId: rent, amountCents: 80000, rollover: false }]);
    const [row] = await getBudgetProgress(db, user.id, RANGE);
    expect(row).toMatchObject({ categoryId: rent, parentId: null, parentName: null });
  });

  it("drops every budget when a parent is deleted with its subcategories", async () => {
    const { user } = await setup();
    const housing = await makeCategory(user.id, "Housing");
    const rent = await makeCategory(user.id, "Rent", housing);
    await setBudget(db, user.id, housing, 100000);
    await setBudget(db, user.id, rent, 80000);

    const result = await deleteCategory(db, user.id, housing, "delete_subcategories");
    expect(result.ok).toBe(true);
    expect(await listBudgets(db, user.id)).toEqual([]);
  });
});

describe("budgets with split transactions", () => {
  beforeEach(resetDb);

  it("count each part against its own category, subcategories roll up, month figures unchanged", async () => {
    const { user, account } = await setup();
    const food = await makeCategory(user.id, "Food");
    const veg = await makeCategory(user.id, "Veg", food);
    const home = await makeCategory(user.id, "Home");
    const [split] = await seed(user.id, account.id, [
      { date: "2026-03-05", amountCents: -4450, categoryId: home },
      { date: "2026-03-06", amountCents: -1000, categoryId: food },
    ]);
    const saved = await saveSplit(db, user.id, split, [
      { categoryId: veg, amountCents: -3210 },
      { categoryId: home, amountCents: -1240 },
    ]);
    expect(saved.ok).toBe(true);
    await setBudget(db, user.id, food, 50000);
    await setBudget(db, user.id, veg, 50000);
    await setBudget(db, user.id, home, 50000);

    const rows = await getBudgetProgress(db, user.id, RANGE);
    const spent = Object.fromEntries(rows.map((r) => [r.name, r.spentCents]));
    // Food = own 1000 + Veg part 3210; Home = only the 1240 part (the row's own category is ignored).
    expect(spent).toEqual({ Food: 4210, Veg: 3210, Home: 1240 });
  });

  it("still exclude internal transfers", async () => {
    const { user, account } = await setup();
    const food = await makeCategory(user.id, "Food");
    const [out, inn, split] = await seed(user.id, account.id, [
      { date: "2026-03-05", amountCents: -2500, categoryId: food },
      { date: "2026-03-05", amountCents: 2500 },
      { date: "2026-03-06", amountCents: -1000 },
    ]);
    await db.insert(transfers).values({ userId: user.id, outTransactionId: out, inTransactionId: inn, status: "confirmed" });
    await saveSplit(db, user.id, split, [
      { categoryId: food, amountCents: -700 },
      { categoryId: food, amountCents: -300 },
    ]);
    await setBudget(db, user.id, food, 50000);
    const [row] = await getBudgetProgress(db, user.id, RANGE);
    expect(row.spentCents).toBe(1000);
  });
});

const month = (m: string) => ({ from: `${m}-01`, to: `${m}-${m.endsWith("02") ? "28" : m.endsWith("04") ? "30" : "31"}` });

describe("budget rollover", () => {
  beforeEach(resetDb);

  async function rolloverRow(categoryId: string) {
    const [row] = await db.select().from(categoryBudgets).where(eq(categoryBudgets.categoryId, categoryId));
    return row;
  }

  it("starts in the given month with no carry, and stays off by default", async () => {
    const { user } = await setup();
    const gifts = await makeCategory(user.id, "Gifts");
    const food = await makeCategory(user.id, "Food");
    await setBudget(db, user.id, gifts, 5000, { rollover: true, month: "2026-01" });
    await setBudget(db, user.id, food, 5000, { month: "2026-01" });
    expect(await rolloverRow(gifts)).toMatchObject({ rollover: true, rolloverStart: "2026-01-01", rolloverBaseCents: 0 });
    expect(await rolloverRow(food)).toMatchObject({ rollover: false, rolloverStart: null });

    const rows = await getBudgetProgress(db, user.id, month("2026-01"));
    expect(rows.find((r) => r.categoryId === gifts)?.carryCents).toBe(0);
    expect(rows.find((r) => r.categoryId === food)?.carryCents).toBeNull();
    // Before the start month there is no carry at all.
    expect((await getBudgetProgress(db, user.id, month("2025-12"))).find((r) => r.categoryId === gifts)?.carryCents).toBeNull();
  });

  it("carries leftovers and overspending across months, splits and transfers included", async () => {
    const { user, account } = await setup();
    const created = await createAccount(db, user.id, "Savings");
    if (!created.ok) throw new Error("createAccount failed");
    const gifts = await makeCategory(user.id, "Gifts");
    const kids = await makeCategory(user.id, "Kids", gifts);
    const other = await makeCategory(user.id, "Other");
    const [split, out] = await seed(user.id, account.id, [
      { date: "2026-02-10", amountCents: -3000, categoryId: other },
      { date: "2026-02-20", amountCents: -9000, categoryId: gifts },
      { date: "2026-01-15", amountCents: -2000, categoryId: kids },
      { date: "2026-03-05", amountCents: -1000, categoryId: gifts },
    ]);
    const [inn] = await seed(user.id, created.account.id, [{ date: "2026-02-20", amountCents: 9000 }]);
    await saveSplit(db, user.id, split, [
      { categoryId: kids, amountCents: -1000 },
      { categoryId: other, amountCents: -2000 },
    ]);
    await setBudget(db, user.id, gifts, 5000, { rollover: true, month: "2026-01" });

    // January: 5000 - 2000 (Kids rolls up) = +3000. February: 5000 - 9000 - 1000 = -5000.
    const march = (await getBudgetProgress(db, user.id, month("2026-03")))[0];
    expect(march).toMatchObject({ categoryId: gifts, carryCents: -2000, spentCents: 1000 });

    // Linking the February outflow as a transfer takes it out of spending.
    expect((await linkTransfer(db, user.id, out, inn)).ok).toBe(true);
    expect((await getBudgetProgress(db, user.id, month("2026-03")))[0].carryCents).toBe(7000);
  });

  it("snapshots the carry when the amount changes, so past months keep their amount", async () => {
    const { user, account } = await setup();
    const car = await makeCategory(user.id, "Car");
    await seed(user.id, account.id, [{ date: "2026-01-10", amountCents: -1000, categoryId: car }]);
    await setBudget(db, user.id, car, 5000, { rollover: true, month: "2026-01" });
    // January +4000, February +5000: 9000 carried into March.
    expect(await setBudget(db, user.id, car, 20000, { rollover: true, month: "2026-03" })).toEqual({ ok: true });
    expect(await rolloverRow(car)).toMatchObject({ rolloverStart: "2026-03-01", rolloverBaseCents: 9000, amountCents: 20000 });
    expect((await getBudgetProgress(db, user.id, month("2026-03")))[0].carryCents).toBe(9000);
    expect((await getBudgetProgress(db, user.id, month("2026-04")))[0].carryCents).toBe(29000);

    // Same amount again: nothing moves.
    await setBudget(db, user.id, car, 20000, { rollover: true, month: "2026-05" });
    expect(await rolloverRow(car)).toMatchObject({ rolloverStart: "2026-03-01", rolloverBaseCents: 9000 });
  });

  it("resets the carry when rollover is turned off, and keeps the setting when not given", async () => {
    const { user } = await setup();
    const car = await makeCategory(user.id, "Car");
    await setBudget(db, user.id, car, 5000, { rollover: true, month: "2026-01" });
    await setBudget(db, user.id, car, 5000, { month: "2026-02" });
    expect(await rolloverRow(car)).toMatchObject({ rollover: true, rolloverStart: "2026-01-01" });

    expect(await setBudget(db, user.id, car, 5000, { rollover: false, month: "2026-03" })).toEqual({ ok: true, carryReset: true });
    expect(await rolloverRow(car)).toMatchObject({ rollover: false, rolloverStart: null, rolloverBaseCents: 0 });
    await setBudget(db, user.id, car, 5000, { rollover: true, month: "2026-04" });
    expect(await rolloverRow(car)).toMatchObject({ rollover: true, rolloverStart: "2026-04-01", rolloverBaseCents: 0 });
  });

  it("rejects a rollover start that isn't the first of a month", async () => {
    const { user } = await setup();
    const car = await makeCategory(user.id, "Car");
    await setBudget(db, user.id, car, 5000);
    await expect(
      db.update(categoryBudgets).set({ rollover: true, rolloverStart: "2026-01-15" }).where(eq(categoryBudgets.categoryId, car)),
    ).rejects.toThrow();
    await expect(db.update(categoryBudgets).set({ rollover: true }).where(eq(categoryBudgets.categoryId, car))).rejects.toThrow();
  });

  it("never counts another user's spending", async () => {
    const a = await setup();
    const b = await setup();
    const giftsA = await makeCategory(a.user.id, "Gifts");
    const giftsB = await makeCategory(b.user.id, "Gifts");
    await seed(b.user.id, b.account.id, [{ date: "2026-01-10", amountCents: -4000, categoryId: giftsB }]);
    await setBudget(db, a.user.id, giftsA, 5000, { rollover: true, month: "2026-01" });
    expect((await getBudgetProgress(db, a.user.id, month("2026-02")))[0].carryCents).toBe(5000);
  });
});

describe("recurring spending in budget rows", () => {
  beforeEach(resetDb);

  it("reports the part of spending linked to a recurring item, rolled up", async () => {
    const { user, account } = await setup();
    const housing = await makeCategory(user.id, "Housing");
    const rent = await makeCategory(user.id, "Rent", housing);
    const [item] = await db
      .insert(recurring)
      .values({
        userId: user.id,
        accountId: account.id,
        merchantKey: "rent",
        typicalAmountCents: -80000,
        interval: "monthly",
        lastSeenDate: "2026-03-01",
      })
      .returning();
    const [paid] = await seed(user.id, account.id, [
      { date: "2026-03-01", amountCents: -80000, categoryId: rent },
      { date: "2026-03-04", amountCents: -2000, categoryId: housing },
    ]);
    await db.update(transactions).set({ recurringId: item.id }).where(eq(transactions.id, paid));
    await setBudget(db, user.id, housing, 100000);
    expect((await getBudgetProgress(db, user.id, RANGE))[0]).toMatchObject({ spentCents: 82000, recurringSpentCents: 80000 });
  });
});

describe("getBudgetPresets", () => {
  beforeEach(resetDb);

  it("gives last month and the 3-month average, rolled up and rounded up to the euro", async () => {
    const { user, account } = await setup();
    const food = await makeCategory(user.id, "Food");
    const veg = await makeCategory(user.id, "Veg", food);
    await seed(user.id, account.id, [
      { date: "2025-12-05", amountCents: -99999, categoryId: food }, // before the 3 months
      { date: "2026-01-05", amountCents: -10000, categoryId: food },
      { date: "2026-02-05", amountCents: -20000, categoryId: veg },
      { date: "2026-03-05", amountCents: -30001, categoryId: food },
      { date: "2026-04-02", amountCents: -50000, categoryId: food }, // current month
    ]);
    const presets = await getBudgetPresets(db, user.id, "2026-04");
    expect(presets.get(food)).toEqual({ lastMonthCents: 30100, averageCents: 20100 });
    expect(presets.get(veg)).toEqual({ lastMonthCents: 0, averageCents: 6700 });
  });

  it("averages over the months with data when history is short, and is empty without data", async () => {
    const { user, account } = await setup();
    const food = await makeCategory(user.id, "Food");
    expect((await getBudgetPresets(db, user.id, "2026-04")).size).toBe(0);
    await seed(user.id, account.id, [{ date: "2026-03-05", amountCents: -30000, categoryId: food }]);
    expect((await getBudgetPresets(db, user.id, "2026-04")).get(food)).toEqual({ lastMonthCents: 30000, averageCents: 30000 });
  });
});

describe("removeBudget and restoreBudget", () => {
  beforeEach(resetDb);

  it("returns the removed row, and restoring it brings back exactly the same row", async () => {
    const { user } = await setup();
    const food = await makeCategory(user.id, "Food");
    await setBudget(db, user.id, food, 12000, { rollover: true, month: "2026-03" });
    const [before] = await db.select().from(categoryBudgets);
    await db.update(categoryBudgets).set({ rolloverBaseCents: -4500 });

    const snapshot = await removeBudget(db, user.id, food);
    expect(snapshot).toEqual({
      categoryId: food,
      amountCents: 12000,
      rollover: true,
      rolloverStart: "2026-03-01",
      rolloverBaseCents: -4500,
    });
    expect(await listBudgets(db, user.id)).toEqual([]);

    expect(await restoreBudget(db, user.id, snapshot)).toEqual({ ok: true });
    const [after] = await db.select().from(categoryBudgets);
    // Timestamps are bookkeeping; every setting must be the same.
    const settings = ({ createdAt, updatedAt, ...rest }: typeof after) => (void createdAt, void updatedAt, rest);
    expect(settings(after)).toEqual({ ...settings(before), rolloverBaseCents: -4500 });
  });

  it("returns null when there is no budget, and does not remove another user's", async () => {
    const a = await setup();
    const b = await setup();
    const food = await makeCategory(a.user.id, "Food");
    expect(await removeBudget(db, a.user.id, food)).toBeNull();
    await setBudget(db, a.user.id, food, 1000);
    expect(await removeBudget(db, b.user.id, food)).toBeNull();
    expect(await listBudgets(db, a.user.id)).toHaveLength(1);
  });

  it("refuses another user's category and a snapshot that fails validation", async () => {
    const a = await setup();
    const b = await setup();
    const food = await makeCategory(a.user.id, "Food");
    const snapshot = { categoryId: food, amountCents: 1000, rollover: false, rolloverStart: null, rolloverBaseCents: 0 };
    expect(await restoreBudget(db, b.user.id, snapshot)).toEqual({ ok: false, error: "not_found" });
    expect(await restoreBudget(db, a.user.id, { ...snapshot, amountCents: 0 })).toEqual({ ok: false, error: "invalid" });
    expect(await restoreBudget(db, a.user.id, { ...snapshot, rollover: true })).toEqual({ ok: false, error: "invalid" });
    expect(await restoreBudget(db, a.user.id, { ...snapshot, rollover: true, rolloverStart: "2026-03-15" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await db.select().from(categoryBudgets)).toHaveLength(0);
  });

  it("replaces a budget added meanwhile", async () => {
    const { user } = await setup();
    const food = await makeCategory(user.id, "Food");
    await setBudget(db, user.id, food, 5000);
    const snapshot = await removeBudget(db, user.id, food);
    await setBudget(db, user.id, food, 9000);
    expect(await restoreBudget(db, user.id, snapshot)).toEqual({ ok: true });
    expect(await listBudgets(db, user.id)).toEqual([{ categoryId: food, amountCents: 5000, rollover: false }]);
  });
});
