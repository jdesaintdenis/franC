// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { bankCategoryMappings, categories, categoryRules, imports, transactions } from "../schema";
import { createTestUser, resetDb, seedCategories } from "../test-utils";
import { listAccounts } from "./accounts";
import {
  createCategory,
  deleteCategory,
  deleteCategoryIfUnused,
  getCategoryMonthSpending,
  getCategoryUsage,
  isCategoryUnused,
  getOwnedCategory,
  listCategories,
  listCategoryOptions,
  restoreCategory,
  updateCategory,
} from "./categories";
import { setBudget } from "./budgets";
import { createRule } from "./category-rules";
import { provisionUserDefaults } from "./provision";

const NO_CHANGES = {
  transactionsUncategorized: 0,
  transactionsMoved: 0,
  rulesDeleted: 0,
  rulesMoved: 0,
  subcategoriesDeleted: 0,
  subcategoriesPromoted: 0,
};

async function newSub(userId: string, name: string, parentId: string) {
  const result = await createCategory(db, userId, { name, color: "#112233", parentId });
  if (!result.ok) throw new Error(result.error);
  return result.category;
}

/** Files one transaction per category id (in order) and returns them keyed by dedupe hash. */
async function fileTransactions(userId: string, accountId: string, categoryIds: (string | null)[]) {
  const [imp] = await db
    .insert(imports)
    .values({ userId, accountId, filename: "x.csv", rowsTotal: categoryIds.length, rowsError: 0 })
    .returning();
  await db.insert(transactions).values(
    categoryIds.map((categoryId, i) => ({
      userId,
      accountId,
      importId: imp.id,
      date: "2025-01-01",
      amountCents: -100,
      dedupeHash: `h${i}`,
      occurrenceIndex: 0,
      categoryId,
      categorySource: categoryId ? ("manual" as const) : null,
    })),
  );
}

async function txByHash(userId: string) {
  const rows = await db.select().from(transactions).where(eq(transactions.userId, userId));
  return Object.fromEntries(rows.map((r) => [r.dedupeHash, r]));
}

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  await seedCategories(user.id);
  const [account] = await listAccounts(user.id);
  return { user, account };
}

async function newCategory(userId: string, name: string) {
  const result = await createCategory(db, userId, { name, color: "#112233" });
  if (!result.ok) throw new Error(result.error);
  return result.category;
}

describe("categories queries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates, renames and recolors a category", async () => {
    const { user } = await setup();
    const category = await newCategory(user.id, "Pets");
    expect(await getOwnedCategory(db, user.id, category.id)).toMatchObject({
      name: "Pets",
      color: "#112233",
    });

    const updated = await updateCategory(db, user.id, category.id, {
      name: "Animals",
      color: "#445566",
    });
    expect(updated).toMatchObject({
      ok: true,
      category: { name: "Animals", color: "#445566" },
    });
    expect((await listCategories(user.id)).some((c) => c.name === "Animals")).toBe(true);
  });

  it("reports a duplicate name on create and on rename", async () => {
    const { user } = await setup();
    expect(
      await createCategory(db, user.id, {
        name: "Groceries",
        color: "#112233",
      }),
    ).toEqual({
      ok: false,
      error: "name_taken",
    });
    const pets = await newCategory(user.id, "Pets");
    expect(
      await updateCategory(db, user.id, pets.id, {
        name: "Groceries",
        color: "#112233",
      }),
    ).toEqual({
      ok: false,
      error: "name_taken",
    });
  });

  it("allows the same name for different users", async () => {
    const { user } = await setup();
    const other = await createTestUser();
    await provisionUserDefaults(db, other.id);
    await seedCategories(other.id);
    expect((await createCategory(db, other.id, { name: "Pets", color: "#112233" })).ok).toBe(true);
    expect((await createCategory(db, user.id, { name: "Pets", color: "#112233" })).ok).toBe(true);
  });

  it("delete uncategorizes its transactions (source null) and cascades its rules", async () => {
    const { user, account } = await setup();
    const doomed = await newCategory(user.id, "Doomed");
    const kept = await newCategory(user.id, "Kept");
    await createRule(db, user.id, {
      categoryId: doomed.id,
      matchType: "contains",
      pattern: "a",
    });
    await createRule(db, user.id, {
      categoryId: doomed.id,
      matchType: "equals",
      pattern: "b",
    });
    await createRule(db, user.id, {
      categoryId: kept.id,
      matchType: "contains",
      pattern: "c",
    });

    const [imp] = await db
      .insert(imports)
      .values({
        userId: user.id,
        accountId: account.id,
        filename: "x.csv",
        rowsTotal: 3,
        rowsError: 0,
      })
      .returning();
    const base = {
      userId: user.id,
      accountId: account.id,
      importId: imp.id,
      date: "2025-01-01",
      amountCents: -100,
    };
    await db.insert(transactions).values([
      {
        ...base,
        dedupeHash: "h1",
        occurrenceIndex: 0,
        categoryId: doomed.id,
        categorySource: "manual",
      },
      {
        ...base,
        dedupeHash: "h2",
        occurrenceIndex: 0,
        categoryId: doomed.id,
        categorySource: "rule",
      },
      {
        ...base,
        dedupeHash: "h3",
        occurrenceIndex: 0,
        categoryId: kept.id,
        categorySource: "rule",
      },
    ]);

    expect(await getCategoryUsage(db, user.id, doomed.id)).toEqual({
      transactions: 2,
      rules: 2,
      subcategories: 0,
      subcategoryTransactions: 0,
      subcategoryRules: 0,
      parent: null,
      budget: false,
      bankMappings: 0,
    });
    expect(await deleteCategory(db, user.id, doomed.id)).toEqual({
      ok: true,
      ...NO_CHANGES,
      transactionsUncategorized: 2,
      rulesDeleted: 2,
    });

    expect(await getOwnedCategory(db, user.id, doomed.id)).toBeNull();
    const rows = await db.select().from(transactions).where(eq(transactions.userId, user.id));
    const byHash = Object.fromEntries(rows.map((r) => [r.dedupeHash, r]));
    expect(byHash.h1).toMatchObject({ categoryId: null, categorySource: null });
    expect(byHash.h2).toMatchObject({ categoryId: null, categorySource: null });
    expect(byHash.h3).toMatchObject({
      categoryId: kept.id,
      categorySource: "rule",
    });
    const rules = await db.select().from(categoryRules).where(eq(categoryRules.userId, user.id));
    expect(rules.map((r) => r.categoryId)).toEqual([kept.id]);
    expect(await deleteCategory(db, user.id, doomed.id)).toEqual({ ok: false, error: "not_found" });
  });

  it("only counts rows scoped to the user", async () => {
    const { user } = await setup();
    const category = await newCategory(user.id, "Pets");
    const stranger = await createTestUser();
    expect(await getCategoryUsage(db, stranger.id, category.id)).toBeNull();
    expect(
      await db
        .select()
        .from(categoryRules)
        .where(and(eq(categoryRules.userId, stranger.id), eq(categoryRules.categoryId, category.id))),
    ).toHaveLength(0);
  });
  describe("subcategories", () => {
    it("creates a subcategory and lists ordered options with path labels", async () => {
      const { user } = await setup();
      const housing = await newCategory(user.id, "Home");
      const furniture = await newSub(user.id, "Furniture", housing.id);
      expect(furniture.parentId).toBe(housing.id);
      const options = await listCategoryOptions(user.id, "en");
      const i = options.findIndex((o) => o.id === housing.id);
      expect(options[i + 1]).toMatchObject({ id: furniture.id, label: "Home > Furniture", parentName: "Home" });
    });

    it("allows the same name under different parents but not twice under one, nor twice at top level", async () => {
      const { user } = await setup();
      const a = await newCategory(user.id, "Home");
      const b = await newCategory(user.id, "Auto");
      await newSub(user.id, "Other", a.id);
      await newSub(user.id, "Other", b.id);
      expect(await createCategory(db, user.id, { name: "Other", color: "#112233", parentId: a.id })).toEqual({
        ok: false,
        error: "name_taken",
      });
      expect(await createCategory(db, user.id, { name: "Home", color: "#112233" })).toEqual({
        ok: false,
        error: "name_taken",
      });
      expect(await createCategory(db, user.id, { name: "Home", color: "#112233", parentId: null })).toEqual({
        ok: false,
        error: "name_taken",
      });
    });

    it("rejects unknown parents, subcategory parents", async () => {
      const { user } = await setup();
      const a = await newCategory(user.id, "Home");
      const sub = await newSub(user.id, "Furniture", a.id);
      expect(
        await createCategory(db, user.id, {
          name: "X",
          color: "#112233",
          parentId: "00000000-0000-4000-8000-000000000000",
        }),
      ).toEqual({ ok: false, error: "parent_not_found" });
      expect(await createCategory(db, user.id, { name: "X", color: "#112233", parentId: sub.id })).toEqual({
        ok: false,
        error: "parent_is_subcategory",
      });
    });

    it("moves a category under a parent, to another parent and back to top level; contents follow", async () => {
      const { user, account } = await setup();
      const a = await newCategory(user.id, "Home");
      const b = await newCategory(user.id, "Auto");
      const pets = await newCategory(user.id, "Pets");
      await fileTransactions(user.id, account.id, [pets.id]);
      await createRule(db, user.id, { categoryId: pets.id, matchType: "contains", pattern: "vet" });

      const moved = await updateCategory(db, user.id, pets.id, { name: "Pets", color: "#112233", parentId: a.id });
      expect(moved).toMatchObject({ ok: true, category: { parentId: a.id } });
      expect((await txByHash(user.id)).h0.categoryId).toBe(pets.id);
      const again = await updateCategory(db, user.id, pets.id, { name: "Pets", color: "#112233", parentId: b.id });
      expect(again).toMatchObject({ ok: true, category: { parentId: b.id } });
      const top = await updateCategory(db, user.id, pets.id, { name: "Pets", color: "#112233", parentId: null });
      expect(top).toMatchObject({ ok: true, category: { parentId: null } });
      expect((await db.select().from(categoryRules).where(eq(categoryRules.userId, user.id)))[0].categoryId).toBe(pets.id);
    });

    it("leaves the parent unchanged when parentId is omitted", async () => {
      const { user } = await setup();
      const a = await newCategory(user.id, "Home");
      const sub = await newSub(user.id, "Furniture", a.id);
      const result = await updateCategory(db, user.id, sub.id, { name: "Sofas", color: "#445566" });
      expect(result).toMatchObject({ ok: true, category: { name: "Sofas", parentId: a.id } });
    });

    it("refuses cycles, self-parenting and moving a category that has subcategories", async () => {
      const { user } = await setup();
      const a = await newCategory(user.id, "Home");
      const b = await newCategory(user.id, "Auto");
      const sub = await newSub(user.id, "Furniture", a.id);
      const input = (name: string, parentId: string | null) => ({ name, color: "#112233", parentId });
      expect(await updateCategory(db, user.id, a.id, input("Home", a.id))).toEqual({
        ok: false,
        error: "parent_is_self",
      });
      expect(await updateCategory(db, user.id, a.id, input("Home", sub.id))).toEqual({
        ok: false,
        error: "parent_is_subcategory",
      });
      expect(await updateCategory(db, user.id, a.id, input("Home", b.id))).toEqual({
        ok: false,
        error: "has_subcategories",
      });
      expect(await updateCategory(db, user.id, b.id, input("Auto", sub.id))).toEqual({
        ok: false,
        error: "parent_is_subcategory",
      });
      expect(await updateCategory(db, user.id, "00000000-0000-4000-8000-000000000000", input("Z", null))).toEqual({
        ok: false,
        error: "not_found",
      });
    });

    it("reports a name collision when moving", async () => {
      const { user } = await setup();
      const a = await newCategory(user.id, "Home");
      await newSub(user.id, "Pets", a.id);
      const pets = await newCategory(user.id, "Pets");
      expect(await updateCategory(db, user.id, pets.id, { name: "Pets", color: "#112233", parentId: a.id })).toEqual({
        ok: false,
        error: "name_taken",
      });
    });

    it("getCategoryUsage counts subcategories, their contents and the parent", async () => {
      const { user, account } = await setup();
      const a = await newCategory(user.id, "Home");
      const s1 = await newSub(user.id, "Furniture", a.id);
      const s2 = await newSub(user.id, "Rent", a.id);
      await fileTransactions(user.id, account.id, [a.id, s1.id, s1.id, s2.id]);
      await createRule(db, user.id, { categoryId: s1.id, matchType: "contains", pattern: "ikea" });
      expect(await getCategoryUsage(db, user.id, a.id)).toEqual({
        transactions: 1,
        rules: 0,
        subcategories: 2,
        subcategoryTransactions: 3,
        subcategoryRules: 1,
        parent: null,
        budget: false,
        bankMappings: 0,
      });
      expect(await getCategoryUsage(db, user.id, s1.id)).toMatchObject({
        transactions: 2,
        rules: 1,
        subcategories: 0,
        parent: { id: a.id, name: "Home" },
      });
    });

    it("deleting a subcategory moves its transactions (source kept) and rules to the parent by default", async () => {
      const { user, account } = await setup();
      const a = await newCategory(user.id, "Home");
      const sub = await newSub(user.id, "Furniture", a.id);
      await fileTransactions(user.id, account.id, [sub.id, sub.id, a.id]);
      await createRule(db, user.id, { categoryId: sub.id, matchType: "contains", pattern: "ikea" });

      expect(await deleteCategory(db, user.id, sub.id)).toEqual({
        ok: true,
        ...NO_CHANGES,
        transactionsMoved: 2,
        rulesMoved: 1,
      });
      const rows = await txByHash(user.id);
      expect(rows.h0).toMatchObject({ categoryId: a.id, categorySource: "manual" });
      expect(rows.h1).toMatchObject({ categoryId: a.id, categorySource: "manual" });
      expect((await db.select().from(categoryRules).where(eq(categoryRules.userId, user.id)))[0].categoryId).toBe(a.id);
      expect(await getOwnedCategory(db, user.id, sub.id)).toBeNull();
    });

    it("deleting a subcategory with uncategorize clears transactions and deletes rules", async () => {
      const { user, account } = await setup();
      const a = await newCategory(user.id, "Home");
      const sub = await newSub(user.id, "Furniture", a.id);
      await fileTransactions(user.id, account.id, [sub.id]);
      await createRule(db, user.id, { categoryId: sub.id, matchType: "contains", pattern: "ikea" });
      expect(await deleteCategory(db, user.id, sub.id, "uncategorize")).toEqual({
        ok: true,
        ...NO_CHANGES,
        transactionsUncategorized: 1,
        rulesDeleted: 1,
      });
      expect((await txByHash(user.id)).h0).toMatchObject({ categoryId: null, categorySource: null });
      expect(await db.select().from(categoryRules).where(eq(categoryRules.userId, user.id))).toHaveLength(0);
    });

    it("move_to_parent on a top-level category behaves as uncategorize", async () => {
      const { user, account } = await setup();
      const pets = await newCategory(user.id, "Pets");
      await fileTransactions(user.id, account.id, [pets.id]);
      expect(await deleteCategory(db, user.id, pets.id, "move_to_parent")).toEqual({
        ok: true,
        ...NO_CHANGES,
        transactionsUncategorized: 1,
      });
      expect((await txByHash(user.id)).h0).toMatchObject({ categoryId: null, categorySource: null });
    });

    it("deleting a parent with keep_subcategories promotes children and uncategorizes only the parent's own", async () => {
      const { user, account } = await setup();
      const a = await newCategory(user.id, "Home");
      const sub = await newSub(user.id, "Furniture", a.id);
      await fileTransactions(user.id, account.id, [a.id, sub.id]);
      await createRule(db, user.id, { categoryId: a.id, matchType: "contains", pattern: "rent" });
      await createRule(db, user.id, { categoryId: sub.id, matchType: "contains", pattern: "ikea" });

      expect(await deleteCategory(db, user.id, a.id)).toEqual({
        ok: true,
        ...NO_CHANGES,
        transactionsUncategorized: 1,
        rulesDeleted: 1,
        subcategoriesPromoted: 1,
      });
      const promoted = await getOwnedCategory(db, user.id, sub.id);
      expect(promoted).toMatchObject({ name: "Furniture", parentId: null });
      const rows = await txByHash(user.id);
      expect(rows.h0).toMatchObject({ categoryId: null, categorySource: null });
      expect(rows.h1).toMatchObject({ categoryId: sub.id, categorySource: "manual" });
      const rules = await db.select().from(categoryRules).where(eq(categoryRules.userId, user.id));
      expect(rules.map((r) => r.categoryId)).toEqual([sub.id]);
    });

    it("keep_subcategories fails without changing anything when a child name collides with a top-level name", async () => {
      const { user, account } = await setup();
      const a = await newCategory(user.id, "Home");
      const sub = await newSub(user.id, "Pets", a.id);
      await newCategory(user.id, "Pets");
      await fileTransactions(user.id, account.id, [a.id, sub.id]);
      expect(await deleteCategory(db, user.id, a.id, "keep_subcategories")).toEqual({
        ok: false,
        error: "subcategory_name_taken",
      });
      expect(await getOwnedCategory(db, user.id, a.id)).not.toBeNull();
      expect(await getOwnedCategory(db, user.id, sub.id)).toMatchObject({ parentId: a.id });
      expect((await txByHash(user.id)).h0.categoryId).toBe(a.id);
    });

    it("deleting a parent with delete_subcategories removes everything under it", async () => {
      const { user, account } = await setup();
      const a = await newCategory(user.id, "Home");
      const other = await newCategory(user.id, "Auto");
      const s1 = await newSub(user.id, "Furniture", a.id);
      const s2 = await newSub(user.id, "Rent", a.id);
      await fileTransactions(user.id, account.id, [a.id, s1.id, s2.id, other.id]);
      await createRule(db, user.id, { categoryId: s1.id, matchType: "contains", pattern: "ikea" });
      await createRule(db, user.id, { categoryId: a.id, matchType: "contains", pattern: "rent" });
      await createRule(db, user.id, { categoryId: other.id, matchType: "contains", pattern: "bus" });

      expect(await deleteCategory(db, user.id, a.id, "delete_subcategories")).toEqual({
        ok: true,
        ...NO_CHANGES,
        transactionsUncategorized: 3,
        rulesDeleted: 2,
        subcategoriesDeleted: 2,
      });
      for (const id of [a.id, s1.id, s2.id]) expect(await getOwnedCategory(db, user.id, id)).toBeNull();
      const rows = await txByHash(user.id);
      expect(rows.h0).toMatchObject({ categoryId: null, categorySource: null });
      expect(rows.h3).toMatchObject({ categoryId: other.id });
      const rules = await db.select().from(categoryRules).where(eq(categoryRules.userId, user.id));
      expect(rules.map((r) => r.categoryId)).toEqual([other.id]);
    });

    it("the database rejects a parent belonging to another user and self-parenting", async () => {
      const { user } = await setup();
      const other = await createTestUser();
      await provisionUserDefaults(db, other.id);
      await seedCategories(other.id);
      const theirs = await newCategory(other.id, "Theirs");
      await expect(
        db.insert(categories).values({ userId: user.id, name: "X", color: "#112233", parentId: theirs.id }),
      ).rejects.toThrow();
      const mine = await newCategory(user.id, "Mine");
      await expect(
        db.update(categories).set({ parentId: mine.id }).where(eq(categories.id, mine.id)),
      ).rejects.toThrow();
    });
  });

  describe("delete with Undo (nothing depends on it)", () => {
    it("deletes an unused category and returns the snapshot Undo needs", async () => {
      const { user } = await setup();
      const parent = await newCategory(user.id, "Pets");
      const result = await deleteCategoryIfUnused(db, user.id, parent.id);
      expect(result).toEqual({
        status: "deleted",
        snapshot: { id: parent.id, name: "Pets", color: "#112233", icon: null, parentId: null },
      });
      expect(await getOwnedCategory(db, user.id, parent.id)).toBeNull();
    });

    it("keeps a category with transactions, rules, subcategories, a budget or a bank mapping", async () => {
      const { user, account } = await setup();
      const withTx = await newCategory(user.id, "A");
      await fileTransactions(user.id, account.id, [withTx.id]);
      const withRule = await newCategory(user.id, "B");
      await createRule(db, user.id, { categoryId: withRule.id, matchType: "contains", pattern: "x" });
      const withSub = await newCategory(user.id, "C");
      await newSub(user.id, "C1", withSub.id);
      const withBudget = await newCategory(user.id, "D");
      await setBudget(db, user.id, withBudget.id, 1000);
      const withMapping = await newCategory(user.id, "E");
      await db
        .insert(bankCategoryMappings)
        .values({ userId: user.id, bankCategory: "Food", categoryId: withMapping.id });

      for (const c of [withTx, withRule, withSub, withBudget, withMapping]) {
        const result = await deleteCategoryIfUnused(db, user.id, c.id);
        expect(result.status).toBe("in_use");
        if (result.status === "in_use") expect(isCategoryUnused(result.usage)).toBe(false);
        expect(await getOwnedCategory(db, user.id, c.id)).not.toBeNull();
      }
    });

    it("counts a split part as a dependency", async () => {
      const { user, account } = await setup();
      const category = await newCategory(user.id, "Split target");
      await fileTransactions(user.id, account.id, [null]);
      const { transactionSplits } = await import("../schema");
      const [row] = await db.select().from(transactions).where(eq(transactions.userId, user.id));
      await db.insert(transactionSplits).values([
        { userId: user.id, transactionId: row.id, categoryId: category.id, amountCents: -60, position: 0 },
        { userId: user.id, transactionId: row.id, categoryId: null, amountCents: -40, position: 1 },
      ]);
      expect((await deleteCategoryIfUnused(db, user.id, category.id)).status).toBe("in_use");
    });

    it("is not_found for another user's category", async () => {
      const a = await setup();
      const b = await setup();
      const mine = await newCategory(a.user.id, "Mine");
      expect(await deleteCategoryIfUnused(db, b.user.id, mine.id)).toEqual({ status: "not_found" });
      expect(await getOwnedCategory(db, a.user.id, mine.id)).not.toBeNull();
    });

    it("restores the same id, name, colour, icon and parent", async () => {
      const { user } = await setup();
      const parent = await newCategory(user.id, "Home");
      const sub = await newSub(user.id, "Furniture", parent.id);
      const deleted = await deleteCategoryIfUnused(db, user.id, sub.id);
      if (deleted.status !== "deleted") throw new Error(deleted.status);
      const restored = await restoreCategory(db, user.id, deleted.snapshot);
      expect(restored).toMatchObject({ ok: true, category: { id: sub.id, name: "Furniture", parentId: parent.id } });
    });

    it("refuses when the name is taken, the parent is gone, the id exists or the parent isn't the user's", async () => {
      const a = await setup();
      const b = await setup();
      const pets = await newCategory(a.user.id, "Pets");
      const snap = { id: pets.id, name: "Pets", color: "#112233", icon: "🐶", parentId: null };
      // The id still exists.
      expect(await restoreCategory(db, a.user.id, { ...snap, name: "Renamed" })).toEqual({
        ok: false,
        error: "conflict",
      });
      await deleteCategoryIfUnused(db, a.user.id, pets.id);
      // Name taken by a new category.
      await newCategory(a.user.id, "Pets");
      expect(await restoreCategory(db, a.user.id, snap)).toEqual({ ok: false, error: "name_taken" });
      // Parent that doesn't exist, or belongs to someone else.
      const stranger = await newCategory(b.user.id, "Elsewhere");
      expect(await restoreCategory(db, a.user.id, { ...snap, name: "Other", parentId: stranger.id })).toEqual({
        ok: false,
        error: "parent_not_found",
      });
    });
  });

  describe("getCategoryMonthSpending", () => {
    it("rolls spending up to the parent and ignores other months and inflows", async () => {
      const { user, account } = await setup();
      const parent = await newCategory(user.id, "Home");
      const sub = await newSub(user.id, "Furniture", parent.id);
      const [imp] = await db
        .insert(imports)
        .values({ userId: user.id, accountId: account.id, filename: "x.csv", rowsTotal: 4, rowsError: 0 })
        .returning();
      const base = { userId: user.id, accountId: account.id, importId: imp.id, occurrenceIndex: 0 };
      await db.insert(transactions).values([
        { ...base, date: "2026-09-03", amountCents: -4500, dedupeHash: "m1", categoryId: sub.id },
        { ...base, date: "2026-09-04", amountCents: -500, dedupeHash: "m2", categoryId: parent.id },
        { ...base, date: "2026-09-05", amountCents: 900, dedupeHash: "m3", categoryId: sub.id },
        { ...base, date: "2026-08-05", amountCents: -700, dedupeHash: "m4", categoryId: sub.id },
      ]);
      expect(await getCategoryMonthSpending(db, user.id, "2026-09")).toEqual({
        [sub.id]: 4500,
        [parent.id]: 5000,
      });
    });
  });

  describe("create from the picker (Slice 54)", () => {
    it("refuses a parent that belongs to another user and creates nothing", async () => {
      const { user } = await setup();
      const other = await createTestUser();
      await provisionUserDefaults(db, other.id);
      const theirs = await newCategory(other.id, "Food");
      const result = await createCategory(db, user.id, { name: "Courses54", color: "#112233", parentId: theirs.id });
      expect(result).toEqual({ ok: false, error: "parent_not_found" });
      expect(await db.select().from(categories).where(eq(categories.name, "Courses54"))).toEqual([]);
    });

    it("creates under the caller's user_id, even when another user has the same name", async () => {
      const { user } = await setup();
      const other = await createTestUser();
      await provisionUserDefaults(db, other.id);
      await newCategory(other.id, "Food54");
      const mine = await newCategory(user.id, "Food54");
      expect(mine.userId).toBe(user.id);
      const theirs = await db.select().from(categories).where(eq(categories.userId, other.id));
      expect(theirs.filter((c) => c.name === "Food54")).toHaveLength(1);
    });

    it("refuses a duplicate name under the same parent", async () => {
      const { user } = await setup();
      await newCategory(user.id, "Food54");
      expect(await createCategory(db, user.id, { name: "Food54", color: "#112233" })).toEqual({ ok: false, error: "name_taken" });
    });
  });
});
