// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { parseTransactionFilters } from "../../lib/transactions/filters";
import { db } from "../client";
import { categories, imports, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { createAccount, listAccounts } from "./accounts";
import { createRule } from "./category-rules";
import { createCategory } from "./categories";
import { setBudget } from "./budgets";
import { exportBudgets, exportCategories, exportRules, exportTransactions } from "./export";
import { provisionUserDefaults } from "./provision";
import { saveSplit } from "./splits";
import { addTagsToTransaction, setTransactionNote } from "./tags";
import { linkTransfer } from "./transfers";

let hashCounter = 0;

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [main] = await listAccounts(user.id);
  const created = await createAccount(db, user.id, "Savings");
  if (!created.ok) throw new Error("createAccount failed");
  const [imp] = await db
    .insert(imports)
    .values({ userId: user.id, accountId: main.id, filename: "x.csv", rowsTotal: 0, rowsError: 0 })
    .returning();
  return { user, main, savings: created.account, importId: imp.id };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function seed(
  ctx: Ctx,
  rows: { date?: string; amountCents: number; label?: string; categoryId?: string; accountId?: string }[],
): Promise<string[]> {
  const inserted = await db
    .insert(transactions)
    .values(
      rows.map((r) => ({
        userId: ctx.user.id,
        accountId: r.accountId ?? ctx.main.id,
        importId: ctx.importId,
        date: r.date ?? "2025-09-29",
        amountCents: r.amountCents,
        labelRaw: r.label ?? "ORANGE",
        labelNormalized: (r.label ?? "ORANGE").toLowerCase(),
        labelDisplay: r.label ?? "ORANGE",
        categoryId: r.categoryId ?? null,
        categorySource: r.categoryId ? ("manual" as const) : null,
        dedupeHash: `e${hashCounter++}`,
        occurrenceIndex: 0,
      })),
    )
    .returning({ id: transactions.id });
  return inserted.map((r) => r.id);
}

async function category(userId: string, name: string, parentId: string | null = null): Promise<string> {
  const r = await createCategory(db, userId, { name, color: "#112233", parentId });
  if (!r.ok) throw new Error(r.error);
  return r.category.id;
}

const filters = (params: Record<string, string> = {}) => parseTransactionFilters(params);

describe("exportTransactions", () => {
  beforeEach(resetDb);

  it("returns every matching row oldest first, with account and category names", async () => {
    const ctx = await setup();
    const housing = await category(ctx.user.id, "Housing");
    const internet = await category(ctx.user.id, "Internet", housing);
    await seed(ctx, [
      { date: "2025-09-30", amountCents: 289640, label: "SALARY" },
      { date: "2025-09-29", amountCents: -6650, categoryId: internet },
    ]);
    const rows = await exportTransactions(db, ctx.user.id, filters());
    expect(rows.map((r) => [r.date, r.amountCents, r.accountName])).toEqual([
      ["2025-09-29", -6650, ctx.main.name],
      ["2025-09-30", 289640, ctx.main.name],
    ]);
    expect(rows[0].category).toEqual({ name: "Internet", parentName: "Housing" });
    expect(rows[0].categorySource).toBe("manual");
    expect(rows[1].category).toBeNull();
    expect(rows[0].split).toBeNull();
  });

  it("applies the page's filters: dates, account, parent category covering children, transfers=hide", async () => {
    const ctx = await setup();
    const housing = await category(ctx.user.id, "Housing");
    const internet = await category(ctx.user.id, "Internet", housing);
    const food = await category(ctx.user.id, "Food");
    await seed(ctx, [
      { date: "2025-08-01", amountCents: -1000, categoryId: internet },
      { date: "2025-09-10", amountCents: -2000, categoryId: housing },
      { date: "2025-09-11", amountCents: -3000, categoryId: food },
      { date: "2025-09-12", amountCents: -4000, accountId: ctx.savings.id },
    ]);
    const labels = async (params: Record<string, string>) =>
      (await exportTransactions(db, ctx.user.id, filters(params))).map((r) => r.amountCents);

    expect(await labels({ from: "2025-09-01", to: "2025-09-11" })).toEqual([-2000, -3000]);
    expect(await labels({ account: ctx.savings.id })).toEqual([-4000]);
    expect(await labels({ category: housing })).toEqual([-1000, -2000]);
    expect(await labels({ category: "none" })).toEqual([-4000]);

    const [out, inn] = await seed(ctx, [
      { date: "2025-09-20", amountCents: -5000 },
      { date: "2025-09-20", amountCents: 5000, accountId: ctx.savings.id },
    ]);
    expect((await linkTransfer(db, ctx.user.id, out, inn)).ok).toBe(true);
    expect(await labels({ transfers: "hide" })).toEqual([-1000, -2000, -3000, -4000]);
  });

  it("carries sorted tag names and the note, scoped to the user", async () => {
    const ctx = await setup();
    const other = await setup();
    const [id] = await seed(ctx, [{ amountCents: -100 }, { amountCents: -200 }]);
    const [foreign] = await seed(other, [{ amountCents: -300 }]);
    await addTagsToTransaction(db, ctx.user.id, id, ["work", "Holidays"]);
    await setTransactionNote(db, ctx.user.id, id, "=1+1");
    await addTagsToTransaction(db, other.user.id, foreign, ["Secret"]);
    const rows = await exportTransactions(db, ctx.user.id, filters());
    const byAmount = new Map(rows.map((r) => [r.amountCents, r]));
    expect(byAmount.get(-100)?.tags).toEqual(["Holidays", "work"]);
    expect(byAmount.get(-100)?.note).toBe("=1+1");
    expect(byAmount.get(-200)?.tags).toEqual([]);
    expect(byAmount.get(-200)?.note).toBeNull();
  });

  it("names the other account of a transfer on both legs", async () => {
    const ctx = await setup();
    const [out, inn] = await seed(ctx, [
      { amountCents: -5000 },
      { amountCents: 5000, accountId: ctx.savings.id },
    ]);
    await linkTransfer(db, ctx.user.id, out, inn);
    const rows = await exportTransactions(db, ctx.user.id, filters({ transfers: "only" }));
    const byAmount = new Map(rows.map((r) => [r.amountCents, r.transferAccountName]));
    expect(byAmount.get(-5000)).toBe("Savings");
    expect(byAmount.get(5000)).toBe(ctx.main.name);
  });

  describe("split parts", () => {
    async function splitFixture() {
      const ctx = await setup();
      const housing = await category(ctx.user.id, "Housing");
      const internet = await category(ctx.user.id, "Internet", housing);
      const food = await category(ctx.user.id, "Food");
      const temp = await category(ctx.user.id, "Temp");
      const [id] = await seed(ctx, [{ amountCents: -6650, categoryId: food }]);
      const saved = await saveSplit(db, ctx.user.id, id, [
        { categoryId: food, amountCents: -3000 },
        { categoryId: internet, amountCents: -3000 },
        { categoryId: temp, amountCents: -650 },
      ]);
      if (!saved.ok) throw new Error(saved.error);
      // Deleting a category leaves its part uncategorized.
      await db.delete(categories).where(eq(categories.id, temp));
      return { ctx, housing, internet, food };
    }

    it("writes all parts in position order without a category filter", async () => {
      const { ctx } = await splitFixture();
      const [row] = await exportTransactions(db, ctx.user.id, filters());
      expect(row.split?.total).toBe(3);
      expect(row.split?.parts.map((p) => [p.number, p.category?.name ?? null, p.amountCents])).toEqual([
        [1, "Food", -3000],
        [2, "Internet", -3000],
        [3, null, -650],
      ]);
      expect(row.split?.parts[1].category?.parentName).toBe("Housing");
    });

    it("writes only the matching parts under a category filter, numbered among all", async () => {
      const { ctx, housing, food } = await splitFixture();
      const [byParent] = await exportTransactions(db, ctx.user.id, filters({ category: housing }));
      expect(byParent.split?.parts.map((p) => p.number)).toEqual([2]);
      expect(byParent.split?.total).toBe(3);
      const [byFood] = await exportTransactions(db, ctx.user.id, filters({ category: food }));
      expect(byFood.split?.parts.map((p) => p.number)).toEqual([1]);
      const [none] = await exportTransactions(db, ctx.user.id, filters({ category: "none" }));
      expect(none.split?.parts.map((p) => p.number)).toEqual([3]);
    });
  });

  it("never returns another user's data, even with their ids in the filters", async () => {
    const mine = await setup();
    const theirs = await setup();
    const theirCat = await category(theirs.user.id, "Secret");
    await seed(mine, [{ amountCents: -100, label: "MINE" }]);
    const [theirTx] = await seed(theirs, [{ amountCents: -200, label: "THEIRS", categoryId: theirCat }]);
    await saveSplit(db, theirs.user.id, theirTx, [
      { categoryId: theirCat, amountCents: -100 },
      { categoryId: theirCat, amountCents: -100 },
    ]);

    const all = await exportTransactions(db, mine.user.id, filters());
    expect(all.map((r) => r.labelRaw)).toEqual(["MINE"]);
    expect(await exportTransactions(db, mine.user.id, filters({ account: theirs.main.id }))).toEqual([]);
    expect(await exportTransactions(db, mine.user.id, filters({ category: theirCat }))).toEqual([]);
  });
});

describe("exportCategories / exportRules / exportBudgets", () => {
  beforeEach(resetDb);

  it("returns only the user's categories, rules and budgets", async () => {
    const mine = await setup();
    const theirs = await setup();
    const housing = await category(mine.user.id, "Housing");
    const internet = await category(mine.user.id, "Internet", housing);
    const theirCat = await category(theirs.user.id, "Secret");

    await createRule(db, mine.user.id, { categoryId: internet, matchType: "contains", pattern: "ORANGE" });
    await createRule(db, mine.user.id, { categoryId: housing, matchType: "equals", pattern: "LANDLORD" });
    await createRule(db, theirs.user.id, { categoryId: theirCat, matchType: "contains", pattern: "SECRETRULE" });
    await setBudget(db, mine.user.id, internet, 6650);
    await setBudget(db, theirs.user.id, theirCat, 999);
    // Someone else's category id is refused, so no budget leaks in.
    expect(await setBudget(db, mine.user.id, theirCat, 1)).toEqual({ ok: false, error: "not_found" });

    const cats = await exportCategories(db, mine.user.id);
    expect(cats.map((c) => c.name)).not.toContain("Secret");
    expect(cats.map((c) => c.name)).toEqual(expect.arrayContaining(["Housing", "Internet"]));
    expect(cats.find((c) => c.name === "Internet")).toMatchObject({ parentId: housing, color: "#112233", icon: null });

    const rules = await exportRules(db, mine.user.id);
    expect(rules.map((r) => [r.matchType, r.pattern, r.categoryName, r.parentName])).toEqual([
      ["contains", "ORANGE", "Internet", "Housing"],
      ["equals", "LANDLORD", "Housing", null],
    ]);
    expect(rules[0].priority).toBeLessThan(rules[1].priority);

    expect(await exportBudgets(db, mine.user.id)).toEqual([
      { categoryName: "Internet", parentName: "Housing", amountCents: 6650, rollover: false },
    ]);
  });
});
