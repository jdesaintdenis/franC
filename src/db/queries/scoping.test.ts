// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestUser, resetDb, seedCategories } from "../test-utils";
import { db } from "../client";
import { categoryRules, imports, recurring, transactions } from "../schema";
import { listAccounts } from "./accounts";
import { getBudgetProgress, listBudgets, removeBudget, setBudget } from "./budgets";
import {
  createCategory,
  deleteCategory,
  getCategoryUsage,
  listCategories,
  updateCategory,
} from "./categories";
import {
  applyRulesToUncategorized,
  createRule,
  deleteRule,
  listRules,
  reorderRules,
  updateRule,
} from "./category-rules";
import {
  getLatestTransactionMonth,
  getMonthlyTrend,
  getMonthTotals,
  getSpendingByCategory,
} from "./dashboard";
import { provisionUserDefaults } from "./provision";
import { getSplit, removeSplit, saveSplit } from "./splits";
import { listRecurring, setRecurringStatus } from "./recurring";
import { listTransactions, setTransactionCategory } from "./transactions";

describe("per-user query scoping", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("never returns another user's accounts or categories", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    await provisionUserDefaults(db, userA.id);

    await seedCategories(userA.id);
    await provisionUserDefaults(db, userB.id);
    await seedCategories(userB.id);

    const accountsA = await listAccounts(userA.id);
    const accountsB = await listAccounts(userB.id);
    const categoriesA = await listCategories(userA.id);
    const categoriesB = await listCategories(userB.id);

    expect(accountsA.every((a) => a.userId === userA.id)).toBe(true);
    expect(accountsB.every((a) => a.userId === userB.id)).toBe(true);
    expect(accountsA.some((a) => accountsB.map((b) => b.id).includes(a.id))).toBe(false);

    expect(categoriesA.every((c) => c.userId === userA.id)).toBe(true);
    expect(categoriesB.every((c) => c.userId === userB.id)).toBe(true);
    expect(categoriesA.some((c) => categoriesB.map((b) => b.id).includes(c.id))).toBe(false);
  });

  it("never lists another user's transactions", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const owned: Record<string, string> = {};

    for (const user of [userA, userB]) {
      await provisionUserDefaults(db, user.id);
      await seedCategories(user.id);
      const [account] = await listAccounts(user.id);
      const [imp] = await db
        .insert(imports)
        .values({
          userId: user.id,
          accountId: account.id,
          filename: "x.csv",
          rowsTotal: 1,
          rowsError: 0,
        })
        .returning();
      const [row] = await db
        .insert(transactions)
        .values({
          userId: user.id,
          accountId: account.id,
          importId: imp.id,
          date: "2025-01-01",
          amountCents: -100,
          labelRaw: "LABEL",
          labelNormalized: "LABEL",
          labelDisplay: "Label",
          dedupeHash: `hash-${user.id}`,
          occurrenceIndex: 0,
        })
        .returning({ id: transactions.id });
      owned[user.id] = row.id;
    }

    const { items } = await listTransactions(db, userA.id, { direction: "all" }, null);
    expect(items.map((t) => t.id)).toEqual([owned[userA.id]]);
  });

  it("user B cannot modify or use user A's categories, rules or transactions", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    await provisionUserDefaults(db, userA.id);
    await seedCategories(userA.id);
    await provisionUserDefaults(db, userB.id);
    await seedCategories(userB.id);

    const created = await createCategory(db, userA.id, {
      name: "A only",
      color: "#112233",
    });
    if (!created.ok) throw new Error(created.error);
    const catA = created.category;
    const [catB] = await listCategories(userB.id);
    const ruleA = await createRule(db, userA.id, {
      categoryId: catA.id,
      matchType: "contains",
      pattern: "x",
    });
    if (!ruleA) throw new Error("rule not created");

    const [account] = await listAccounts(userA.id);
    const [imp] = await db
      .insert(imports)
      .values({
        userId: userA.id,
        accountId: account.id,
        filename: "x.csv",
        rowsTotal: 1,
        rowsError: 0,
      })
      .returning();
    const [txA] = await db
      .insert(transactions)
      .values({
        userId: userA.id,
        accountId: account.id,
        importId: imp.id,
        date: "2025-01-01",
        amountCents: -100,
        labelNormalized: "X",
        labelDisplay: "X",
        dedupeHash: "h",
        occurrenceIndex: 0,
      })
      .returning();

    // Categories
    expect(
      await updateCategory(db, userB.id, catA.id, {
        name: "Hijacked",
        color: "#000000",
      }),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await getCategoryUsage(db, userB.id, catA.id)).toBeNull();
    expect(await deleteCategory(db, userB.id, catA.id)).toEqual({ ok: false, error: "not_found" });
    expect(await deleteCategory(db, userB.id, catA.id, "delete_subcategories")).toEqual({
      ok: false,
      error: "not_found",
    });
    // Another user's category can't be a parent, on create or update.
    expect(await createCategory(db, userB.id, { name: "Sneaky", color: "#112233", parentId: catA.id })).toEqual({
      ok: false,
      error: "parent_not_found",
    });
    expect(await updateCategory(db, userB.id, catB.id, { name: catB.name, color: "#112233", parentId: catA.id })).toEqual({
      ok: false,
      error: "parent_not_found",
    });
    expect((await listCategories(userB.id)).find((c) => c.id === catB.id)?.parentId).toBeNull();
    expect((await listCategories(userA.id)).some((c) => c.id === catA.id && c.name === "A only")).toBe(true);

    // Rules
    expect(
      await createRule(db, userB.id, {
        categoryId: catA.id,
        matchType: "contains",
        pattern: "x",
      }),
    ).toBeNull();
    expect(
      await updateRule(db, userB.id, ruleA.id, {
        categoryId: catB.id,
        matchType: "contains",
        pattern: "y",
      }),
    ).toBeNull();
    expect(
      await updateRule(db, userB.id, ruleA.id, {
        categoryId: catA.id,
        matchType: "contains",
        pattern: "y",
      }),
    ).toBeNull();
    expect(await deleteRule(db, userB.id, ruleA.id)).toBeNull();
    expect(await reorderRules(db, userB.id, [ruleA.id])).toBe(false);
    expect(await listRules(db, userB.id)).toEqual([]);
    const [storedRule] = await db.select().from(categoryRules).where(eq(categoryRules.id, ruleA.id));
    expect(storedRule).toMatchObject({ pattern: "x", categoryId: catA.id });

    // Transactions
    expect(await setTransactionCategory(db, userB.id, txA.id, catB.id)).toBeNull();
    expect(await setTransactionCategory(db, userA.id, txA.id, catB.id)).toBeNull();
    expect(await setTransactionCategory(db, userB.id, txA.id, null)).toBeNull();
    expect(await applyRulesToUncategorized(db, userB.id)).toEqual({
      updated: 0,
      byCategory: {},
    });
    const [after] = await db.select().from(transactions).where(eq(transactions.id, txA.id));
    expect(after).toMatchObject({ categoryId: null, categorySource: null });
  });

  it("recurring and dashboard queries never expose or change another user's data", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    await provisionUserDefaults(db, userA.id);
    await seedCategories(userA.id);
    await provisionUserDefaults(db, userB.id);
    await seedCategories(userB.id);

    const [account] = await listAccounts(userA.id);
    const [imp] = await db
      .insert(imports)
      .values({ userId: userA.id, accountId: account.id, filename: "x.csv", rowsTotal: 1, rowsError: 0 })
      .returning();
    await db.insert(transactions).values({
      userId: userA.id,
      accountId: account.id,
      importId: imp.id,
      date: "2025-03-10",
      amountCents: -5000,
      labelNormalized: "X",
      labelDisplay: "X",
      dedupeHash: "scoping-dash",
      occurrenceIndex: 0,
    });
    const [rec] = await db
      .insert(recurring)
      .values({
        userId: userA.id,
        accountId: account.id,
        merchantKey: "x",
        typicalAmountCents: -5000,
        interval: "monthly",
        lastSeenDate: "2025-03-10",
        nextExpectedDate: "2025-04-10",
      })
      .returning();

    // Sanity: the owner sees the data.
    expect(await listRecurring(db, userA.id)).toHaveLength(1);
    expect(await getLatestTransactionMonth(db, userA.id)).toBe("2025-03");

    // Recurring
    expect(await listRecurring(db, userB.id)).toEqual([]);
    expect(await setRecurringStatus(db, userB.id, rec.id, "confirmed")).toBeNull();
    expect(await setRecurringStatus(db, userB.id, rec.id, "dismissed")).toBeNull();
    const [storedRec] = await db.select().from(recurring).where(eq(recurring.id, rec.id));
    expect(storedRec.status).toBe("detected");

    // Dashboard
    const range = { from: "2025-03-01", to: "2025-03-31" };
    expect(await getMonthTotals(db, userB.id, range)).toMatchObject({
      spentCents: 0,
      incomeCents: 0,
      count: 0,
    });
    expect(await getSpendingByCategory(db, userB.id, range)).toEqual([]);
    expect(await getMonthlyTrend(db, userB.id, "2025-01", "2025-06")).toEqual([]);
    expect(await getLatestTransactionMonth(db, userB.id)).toBeNull();
  });

  it("never shows another user's budgets or spending", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    await provisionUserDefaults(db, userA.id);
    await provisionUserDefaults(db, userB.id);
    const created = await createCategory(db, userA.id, { name: "A budgeted", color: "#112233" });
    if (!created.ok) throw new Error(created.error);
    const [account] = await listAccounts(userA.id);
    const [imp] = await db
      .insert(imports)
      .values({ userId: userA.id, accountId: account.id, filename: "x.csv", rowsTotal: 1, rowsError: 0 })
      .returning();
    await db.insert(transactions).values({
      userId: userA.id,
      accountId: account.id,
      importId: imp.id,
      date: "2025-03-10",
      amountCents: -500,
      labelRaw: "L",
      labelNormalized: "L",
      labelDisplay: "L",
      categoryId: created.category.id,
      dedupeHash: "budget-scope",
      occurrenceIndex: 0,
    });
    expect(await setBudget(db, userA.id, created.category.id, 1000)).toEqual({ ok: true });

    const range = { from: "2025-03-01", to: "2025-03-31" };
    expect(await getBudgetProgress(db, userA.id, range)).toHaveLength(1);
    expect(await getBudgetProgress(db, userB.id, range)).toEqual([]);
    expect(await listBudgets(db, userB.id)).toEqual([]);
    expect(await setBudget(db, userB.id, created.category.id, 1)).toEqual({ ok: false, error: "not_found" });
    await removeBudget(db, userB.id, created.category.id);
    expect(await listBudgets(db, userA.id)).toEqual([{ categoryId: created.category.id, amountCents: 1000, rollover: false }]);
  });

  it("split queries never see another user's rows", async () => {
    const users = [await createTestUser(), await createTestUser()];
    const ids: string[] = [];
    const cats: string[] = [];
    for (const user of users) {
      await provisionUserDefaults(db, user.id);
      const created = await createCategory(db, user.id, { name: "Cat", color: "#112233", parentId: null });
      if (!created.ok) throw new Error(created.error);
      cats.push(created.category.id);
      const [account] = await listAccounts(user.id);
      const [imp] = await db
        .insert(imports)
        .values({ userId: user.id, accountId: account.id, filename: "x.csv", rowsTotal: 1, rowsError: 0 })
        .returning();
      const [tx] = await db
        .insert(transactions)
        .values({
          userId: user.id,
          accountId: account.id,
          importId: imp.id,
          date: "2025-03-10",
          amountCents: -1000,
          labelRaw: "L",
          labelNormalized: "l",
          labelDisplay: "L",
          dedupeHash: "split-scope",
          occurrenceIndex: 0,
        })
        .returning({ id: transactions.id });
      ids.push(tx.id);
    }
    const [userA, userB] = users;
    const saved = await saveSplit(db, userA.id, ids[0], [
      { categoryId: cats[0], amountCents: -600 },
      { categoryId: cats[0], amountCents: -400 },
    ]);
    expect(saved.ok).toBe(true);

    // B cannot read, replace or remove A's split, nor use A's category.
    expect(await getSplit(db, userB.id, ids[0])).toBeNull();
    expect(await removeSplit(db, userB.id, ids[0])).toEqual({ ok: false, error: "not_found" });
    const parts = (c: string) => [
      { categoryId: c, amountCents: -600 },
      { categoryId: c, amountCents: -400 },
    ];
    expect(await saveSplit(db, userB.id, ids[0], parts(cats[1]))).toEqual({ ok: false, error: "not_found" });
    expect(await saveSplit(db, userB.id, ids[1], parts(cats[0]))).toEqual({ ok: false, error: "category_not_found" });

    // B's aggregates and list see none of A's parts.
    const range = { from: "2025-03-01", to: "2025-03-31" };
    expect(await getSpendingByCategory(db, userB.id, range)).toEqual([
      expect.objectContaining({ name: null, spentCents: 1000 }),
    ]);
    const listed = await listTransactions(db, userB.id, { direction: "all" }, null);
    expect(listed.items.map((i) => i.split)).toEqual([null]);
    expect((await getSplit(db, userA.id, ids[0]))?.parts).toHaveLength(2);
  });
});
