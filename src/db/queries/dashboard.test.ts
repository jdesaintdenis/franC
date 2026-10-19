// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { fillTrend, monthRange, monthsEnding } from "../../lib/dashboard/month";
import { normalizeLabel } from "../../lib/import/normalize-label";
import { db } from "../client";
import { categories, imports, transactions, transfers } from "../schema";
import { createTestUser, resetDb, seedCategories } from "../test-utils";
import { listAccounts } from "./accounts";
import {
  getDailySpending,
  getLatestTransactionMonth,
  getMonthlyHistory,
  getMonthlyTrend,
  getMonthTotals,
  getReceivedIncome,
  getSpendingByCategory,
  getSubcategoryBreakdown,
  getSubcategorySpending,
  UNCATEGORIZED_COLOR,
} from "./dashboard";
import { provisionUserDefaults } from "./provision";
import { saveSplit } from "./splits";

interface Seed {
  date: string;
  amountCents: number;
  categoryId?: string | null;
}

let seq = 0;

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  await seedCategories(user.id);
  const [account] = await listAccounts(user.id);
  const [imp] = await db
    .insert(imports)
    .values({ userId: user.id, accountId: account.id, filename: "x.csv", rowsTotal: 0, rowsError: 0 })
    .returning();
  return { user, account, importId: imp.id };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function seed(ctx: Ctx, rows: Seed[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(transactions).values(
    rows.map((r) => {
      seq += 1;
      const label = `ROW ${seq}`;
      return {
        userId: ctx.user.id,
        accountId: ctx.account.id,
        importId: ctx.importId,
        date: r.date,
        amountCents: r.amountCents,
        labelRaw: label,
        labelNormalized: normalizeLabel(label),
        labelDisplay: label,
        categoryId: r.categoryId ?? null,
        dedupeHash: `hash-${seq}`,
        occurrenceIndex: 0,
      };
    }),
  );
}

async function makeCategory(ctx: Ctx, name: string, color: string, parentId?: string): Promise<string> {
  const [cat] = await db
    .insert(categories)
    .values({ userId: ctx.user.id, name, color, parentId: parentId ?? null })
    .returning();
  return cat.id;
}

describe("dashboard queries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe("getMonthTotals", () => {
    it("sums spent, income, net and count for the month", async () => {
      const ctx = await setup();
      await seed(ctx, [
        { date: "2025-09-10", amountCents: -1050 },
        { date: "2025-09-11", amountCents: -250 },
        { date: "2025-09-12", amountCents: 200000 },
      ]);
      expect(await getMonthTotals(db, ctx.user.id, monthRange("2025-09"))).toEqual({
        spentCents: 1300,
        incomeCents: 200000,
        netCents: 198700,
        count: 3,
      });
    });

    it("includes the last day and excludes the next month's first day", async () => {
      const ctx = await setup();
      await seed(ctx, [
        { date: "2025-08-31", amountCents: -1 },
        { date: "2025-09-01", amountCents: -10 },
        { date: "2025-09-30", amountCents: -100 },
        { date: "2025-10-01", amountCents: -1000 },
      ]);
      const totals = await getMonthTotals(db, ctx.user.id, monthRange("2025-09"));
      expect(totals.spentCents).toBe(110);
      expect(totals.count).toBe(2);
    });

    it("includes Feb 29 in a leap year and excludes Mar 1", async () => {
      const ctx = await setup();
      await seed(ctx, [
        { date: "2024-02-29", amountCents: -500 },
        { date: "2024-03-01", amountCents: -7000 },
      ]);
      expect((await getMonthTotals(db, ctx.user.id, monthRange("2024-02"))).spentCents).toBe(500);
      expect((await getMonthTotals(db, ctx.user.id, monthRange("2024-03"))).spentCents).toBe(7000);
    });

    it("returns zeros for a month without rows", async () => {
      const ctx = await setup();
      await seed(ctx, [{ date: "2025-08-10", amountCents: -100 }]);
      expect(await getMonthTotals(db, ctx.user.id, monthRange("2025-09"))).toEqual({
        spentCents: 0,
        incomeCents: 0,
        netCents: 0,
        count: 0,
      });
    });

    it("never counts another user's rows", async () => {
      const a = await setup();
      const b = await setup();
      await seed(a, [{ date: "2025-09-10", amountCents: -100 }]);
      await seed(b, [{ date: "2025-09-10", amountCents: -99999 }, { date: "2025-09-11", amountCents: 5000 }]);
      expect(await getMonthTotals(db, a.user.id, monthRange("2025-09"))).toEqual({
        spentCents: 100,
        incomeCents: 0,
        netCents: -100,
        count: 1,
      });
    });
  });

  describe("getSpendingByCategory", () => {
    it("groups outflows by category, largest first", async () => {
      const ctx = await setup();
      const food = await makeCategory(ctx, "Food", "#111111");
      const fun = await makeCategory(ctx, "Fun", "#222222");
      await seed(ctx, [
        { date: "2025-09-01", amountCents: -300, categoryId: fun },
        { date: "2025-09-02", amountCents: -400, categoryId: food },
        { date: "2025-09-03", amountCents: -600, categoryId: food },
      ]);
      expect(await getSpendingByCategory(db, ctx.user.id, monthRange("2025-09"))).toEqual([
        { categoryId: food, name: "Food", color: "#111111", icon: null, spentCents: 1000, hasSubcategorySpending: false },
        { categoryId: fun, name: "Fun", color: "#222222", icon: null, spentCents: 300, hasSubcategorySpending: false },
      ]);
    });

    it("breaks ties by name", async () => {
      const ctx = await setup();
      const b = await makeCategory(ctx, "Beta", "#111111");
      const a = await makeCategory(ctx, "Alpha", "#222222");
      await seed(ctx, [
        { date: "2025-09-01", amountCents: -100, categoryId: b },
        { date: "2025-09-01", amountCents: -100, categoryId: a },
      ]);
      const rows = await getSpendingByCategory(db, ctx.user.id, monthRange("2025-09"));
      expect(rows.map((r) => r.name)).toEqual(["Alpha", "Beta"]);
    });

    it("does not let refunds reduce category spend but counts them as income", async () => {
      const ctx = await setup();
      const shop = await makeCategory(ctx, "Gadgets", "#333333");
      await seed(ctx, [
        { date: "2025-09-01", amountCents: -5000, categoryId: shop },
        { date: "2025-09-05", amountCents: 4000, categoryId: shop },
      ]);
      const range = monthRange("2025-09");
      expect(await getSpendingByCategory(db, ctx.user.id, range)).toEqual([
        { categoryId: shop, name: "Gadgets", color: "#333333", icon: null, spentCents: 5000, hasSubcategorySpending: false },
      ]);
      const totals = await getMonthTotals(db, ctx.user.id, range);
      expect(totals.incomeCents).toBe(4000);
      expect(totals.spentCents).toBe(5000);
    });

    it("buckets uncategorized outflows", async () => {
      const ctx = await setup();
      await seed(ctx, [
        { date: "2025-09-01", amountCents: -250 },
        { date: "2025-09-02", amountCents: -150 },
        { date: "2025-09-03", amountCents: 900 },
      ]);
      expect(await getSpendingByCategory(db, ctx.user.id, monthRange("2025-09"))).toEqual([
        { categoryId: null, name: null, color: UNCATEGORIZED_COLOR, icon: null, spentCents: 400, hasSubcategorySpending: false },
      ]);
    });

    it("never leaks another user's rows or categories", async () => {
      const a = await setup();
      const b = await setup();
      const secret = await makeCategory(b, "Secret", "#000000");
      await seed(a, [{ date: "2025-09-01", amountCents: -100 }]);
      await seed(b, [{ date: "2025-09-01", amountCents: -900, categoryId: secret }]);
      // Even a row of A that points at B's category must not expose its name.
      await seed(a, [{ date: "2025-09-02", amountCents: -50, categoryId: secret }]);

      const rows = await getSpendingByCategory(db, a.user.id, monthRange("2025-09"));
      expect(rows).toEqual([
        { categoryId: null, name: null, color: UNCATEGORIZED_COLOR, icon: null, spentCents: 150, hasSubcategorySpending: false },
      ]);
    });

    it("returns an empty list for a month without outflows", async () => {
      const ctx = await setup();
      await seed(ctx, [{ date: "2025-09-01", amountCents: 100 }]);
      expect(await getSpendingByCategory(db, ctx.user.id, monthRange("2025-09"))).toEqual([]);
    });
  });

  describe("subcategory roll-up", () => {
    async function housingSetup() {
      const ctx = await setup();
      const housing = await makeCategory(ctx, "Lodging", "#aa0000");
      const furniture = await makeCategory(ctx, "Sofa", "#00aa00", housing);
      const rent = await makeCategory(ctx, "Lease", "#0000aa", housing);
      const food = await makeCategory(ctx, "Meals", "#111111");
      await seed(ctx, [
        { date: "2025-09-01", amountCents: -1000, categoryId: housing },
        { date: "2025-09-02", amountCents: -300, categoryId: furniture },
        { date: "2025-09-03", amountCents: -500, categoryId: rent },
        { date: "2025-09-04", amountCents: -200, categoryId: rent },
        { date: "2025-09-05", amountCents: -400, categoryId: food },
        { date: "2025-09-06", amountCents: -50 },
        { date: "2025-09-07", amountCents: 9000, categoryId: furniture },
        { date: "2025-10-01", amountCents: -777, categoryId: furniture },
      ]);
      return { ctx, housing, furniture, rent, food };
    }

    it("counts subcategory spending in the top-level total and flags it", async () => {
      const { ctx, housing, food } = await housingSetup();
      const range = monthRange("2025-09");
      const rows = await getSpendingByCategory(db, ctx.user.id, range);
      expect(rows).toEqual([
        { categoryId: housing, name: "Lodging", color: "#aa0000", icon: null, spentCents: 2000, hasSubcategorySpending: true },
        { categoryId: food, name: "Meals", color: "#111111", icon: null, spentCents: 400, hasSubcategorySpending: false },
        { categoryId: null, name: null, color: UNCATEGORIZED_COLOR, icon: null, spentCents: 50, hasSubcategorySpending: false },
      ]);
      const totals = await getMonthTotals(db, ctx.user.id, range);
      expect(rows.reduce((sum, r) => sum + r.spentCents, 0)).toBe(totals.spentCents);
    });

    it("does not flag a parent with only direct spending", async () => {
      const ctx = await setup();
      const housing = await makeCategory(ctx, "Lodging", "#aa0000");
      await makeCategory(ctx, "Lease", "#0000aa", housing);
      await seed(ctx, [{ date: "2025-09-01", amountCents: -100, categoryId: housing }]);
      const rows = await getSpendingByCategory(db, ctx.user.id, monthRange("2025-09"));
      expect(rows.map((r) => r.hasSubcategorySpending)).toEqual([false]);
    });

    it("returns drill-down buckets that add up to the roll-up total", async () => {
      const { ctx, housing, furniture, rent } = await housingSetup();
      const range = monthRange("2025-09");
      const buckets = await getSubcategorySpending(db, ctx.user.id, range, housing);
      expect(buckets).toEqual([
        { categoryId: housing, name: "Lodging", color: "#aa0000", icon: null, spentCents: 1000, isParentItself: true },
        { categoryId: rent, name: "Lease", color: "#0000aa", icon: null, spentCents: 700, isParentItself: false },
        { categoryId: furniture, name: "Sofa", color: "#00aa00", icon: null, spentCents: 300, isParentItself: false },
      ]);
      const [rolled] = await getSpendingByCategory(db, ctx.user.id, range);
      expect(buckets?.reduce((sum, b) => sum + b.spentCents, 0)).toBe(rolled.spentCents);
    });

    it("rejects subcategory ids, unknown ids and other users' categories", async () => {
      const { ctx, furniture } = await housingSetup();
      const other = await setup();
      const theirs = await makeCategory(other, "Theirs", "#000000");
      const range = monthRange("2025-09");
      expect(await getSubcategorySpending(db, ctx.user.id, range, furniture)).toBeNull();
      expect(await getSubcategorySpending(db, ctx.user.id, range, theirs)).toBeNull();
      expect(
        await getSubcategorySpending(db, ctx.user.id, range, "00000000-0000-4000-8000-000000000000"),
      ).toBeNull();
    });

    it("returns every parent's buckets at once, matching the single-parent drill-down", async () => {
      const { ctx, housing, food } = await housingSetup();
      const range = monthRange("2025-09");
      const breakdown = await getSubcategoryBreakdown(db, ctx.user.id, range);
      expect([...breakdown.keys()]).toEqual([housing]);
      expect(breakdown.get(housing)).toEqual(await getSubcategorySpending(db, ctx.user.id, range, housing));
      // A category without subcategory spending has no breakdown.
      expect(breakdown.has(food)).toBe(false);
    });

    it("keeps the breakdown scoped to the user and the account", async () => {
      const { ctx, housing } = await housingSetup();
      const other = await setup();
      await seed(other, [{ date: "2025-09-01", amountCents: -99999, categoryId: housing }]);
      const range = monthRange("2025-09");
      const buckets = (await getSubcategoryBreakdown(db, ctx.user.id, range)).get(housing);
      expect(buckets?.reduce((sum, b) => sum + b.spentCents, 0)).toBe(2000);
      expect((await getSubcategoryBreakdown(db, other.user.id, range)).size).toBe(0);
      const foreign = { accountId: "00000000-0000-4000-8000-000000000000" };
      expect((await getSubcategoryBreakdown(db, ctx.user.id, range, foreign)).size).toBe(0);
    });

    it("never includes another user's rows in a drill-down", async () => {
      const { ctx, housing } = await housingSetup();
      const other = await setup();
      // Other user's row pointing at this user's category must not leak in.
      await seed(other, [{ date: "2025-09-01", amountCents: -99999, categoryId: housing }]);
      const buckets = await getSubcategorySpending(db, ctx.user.id, monthRange("2025-09"), housing);
      expect(buckets?.reduce((sum, b) => sum + b.spentCents, 0)).toBe(2000);
    });
  });

  describe("getMonthlyTrend", () => {
    it("groups by month inside the range and fillTrend zero-fills gaps", async () => {
      const ctx = await setup();
      await seed(ctx, [
        { date: "2025-06-30", amountCents: -100 },
        { date: "2025-07-01", amountCents: -200 },
        { date: "2025-07-15", amountCents: 1000 },
        { date: "2025-09-30", amountCents: -300 },
        { date: "2025-10-01", amountCents: -9999 },
        { date: "2025-05-31", amountCents: -9999 },
      ]);
      const rows = await getMonthlyTrend(db, ctx.user.id, "2025-06", "2025-09");
      expect(rows).toEqual([
        { month: "2025-06", spentCents: 100, incomeCents: 0 },
        { month: "2025-07", spentCents: 200, incomeCents: 1000 },
        { month: "2025-09", spentCents: 300, incomeCents: 0 },
      ]);
      expect(fillTrend(rows, monthsEnding("2025-09", 4))).toEqual([
        { month: "2025-06", spentCents: 100, incomeCents: 0 },
        { month: "2025-07", spentCents: 200, incomeCents: 1000 },
        { month: "2025-08", spentCents: 0, incomeCents: 0 },
        { month: "2025-09", spentCents: 300, incomeCents: 0 },
      ]);
    });

    it("never includes another user's rows", async () => {
      const a = await setup();
      const b = await setup();
      await seed(a, [{ date: "2025-09-01", amountCents: -100 }]);
      await seed(b, [{ date: "2025-09-01", amountCents: -500 }]);
      expect(await getMonthlyTrend(db, a.user.id, "2025-09", "2025-09")).toEqual([
        { month: "2025-09", spentCents: 100, incomeCents: 0 },
      ]);
    });
  });

  describe("getMonthlyHistory", () => {
    it("covers all months in order with counts", async () => {
      const ctx = await setup();
      await seed(ctx, [
        { date: "2025-09-30", amountCents: -300 },
        { date: "2024-01-05", amountCents: -100 },
        { date: "2024-01-06", amountCents: 1000 },
        { date: "2025-03-01", amountCents: -50 },
      ]);
      expect(await getMonthlyHistory(db, ctx.user.id)).toEqual([
        { month: "2024-01", spentCents: 100, incomeCents: 1000, count: 2 },
        { month: "2025-03", spentCents: 50, incomeCents: 0, count: 1 },
        { month: "2025-09", spentCents: 300, incomeCents: 0, count: 1 },
      ]);
    });

    it("is scoped by user", async () => {
      const a = await setup();
      const b = await setup();
      await seed(a, [{ date: "2025-09-01", amountCents: -100 }]);
      await seed(b, [{ date: "2025-09-01", amountCents: -500 }]);
      expect(await getMonthlyHistory(db, a.user.id)).toEqual([
        { month: "2025-09", spentCents: 100, incomeCents: 0, count: 1 },
      ]);
    });

    it("narrows to one account", async () => {
      const ctx = await setup();
      await seed(ctx, [{ date: "2025-09-01", amountCents: -100 }]);
      expect(await getMonthlyHistory(db, ctx.user.id, { accountId: ctx.account.id })).toHaveLength(1);
      expect(await getMonthlyHistory(db, ctx.user.id, { accountId: "00000000-0000-4000-8000-000000000000" })).toEqual([]);
    });

    it("excludes internal transfers, even from the count", async () => {
      const ctx = await setup();
      await seed(ctx, [
        { date: "2025-08-10", amountCents: -2500 },
        { date: "2025-08-10", amountCents: 2500 },
        { date: "2025-09-01", amountCents: -100 },
      ]);
      const rows = await db.select().from(transactions).where(eq(transactions.date, "2025-08-10"));
      const out = rows.find((r) => r.amountCents < 0)!.id;
      const inn = rows.find((r) => r.amountCents > 0)!.id;
      await db.insert(transfers).values({ userId: ctx.user.id, outTransactionId: out, inTransactionId: inn, status: "confirmed" });
      expect(await getMonthlyHistory(db, ctx.user.id)).toEqual([
        { month: "2025-09", spentCents: 100, incomeCents: 0, count: 1 },
      ]);
    });
  });

  describe("getLatestTransactionMonth", () => {
    it("is null without data", async () => {
      const ctx = await setup();
      expect(await getLatestTransactionMonth(db, ctx.user.id)).toBeNull();
    });

    it("returns the month of the newest transaction, scoped to the user", async () => {
      const a = await setup();
      const b = await setup();
      await seed(a, [
        { date: "2025-03-31", amountCents: -1 },
        { date: "2025-08-02", amountCents: -1 },
      ]);
      await seed(b, [{ date: "2026-01-01", amountCents: -1 }]);
      expect(await getLatestTransactionMonth(db, a.user.id)).toBe("2025-08");
    });
  });
  describe("split transactions", () => {
    async function insertRow(ctx: Ctx, amountCents: number, categoryId: string | null, date = "2025-09-10"): Promise<string> {
      seq += 1;
      const [row] = await db
        .insert(transactions)
        .values({
          userId: ctx.user.id,
          accountId: ctx.account.id,
          importId: ctx.importId,
          date,
          amountCents,
          labelRaw: `SPLIT ${seq}`,
          labelNormalized: `split ${seq}`,
          labelDisplay: `SPLIT ${seq}`,
          categoryId,
          dedupeHash: `split-hash-${seq}`,
          occurrenceIndex: 0,
        })
        .returning({ id: transactions.id });
      return row.id;
    }

    async function split(ctx: Ctx, id: string, parts: [string, number][]) {
      const result = await saveSplit(
        db,
        ctx.user.id,
        id,
        parts.map(([categoryId, amountCents]) => ({ categoryId, amountCents })),
      );
      if (!result.ok) throw new Error(result.error);
    }

    const range = monthRange("2025-09");

    it("counts each part in its own category; month totals and count are unchanged", async () => {
      const ctx = await setup();
      const groceries = await makeCategory(ctx, "Groc", "#111111");
      const household = await makeCategory(ctx, "House", "#222222");
      // The row's own category is ignored while split.
      const id = await insertRow(ctx, -4450, household);
      await split(ctx, id, [[groceries, -3210], [household, -1240]]);
      await insertRow(ctx, -1000, groceries);
      await insertRow(ctx, -700, null);

      const spending = await getSpendingByCategory(db, ctx.user.id, range);
      expect(spending.map((c) => [c.name, c.spentCents])).toEqual([
        ["Groc", 4210],
        ["House", 1240],
        [null, 700],
      ]);
      expect(await getMonthTotals(db, ctx.user.id, range)).toEqual({
        spentCents: 6150,
        incomeCents: 0,
        netCents: -6150,
        count: 3,
      });
      expect(await getMonthlyTrend(db, ctx.user.id, "2025-09", "2025-09")).toEqual([
        { month: "2025-09", spentCents: 6150, incomeCents: 0 },
      ]);
      // Per-category figures sum to the month's spending.
      expect(spending.reduce((sum, c) => sum + c.spentCents, 0)).toBe(6150);
    });

    it("rolls part subcategories up into the parent, and drills down per subcategory", async () => {
      const ctx = await setup();
      const food = await makeCategory(ctx, "Food", "#111111");
      const veg = await makeCategory(ctx, "Veg", "#222222", food);
      const home = await makeCategory(ctx, "Home", "#333333");
      const id = await insertRow(ctx, -5000, null);
      await split(ctx, id, [[veg, -2000], [food, -1500], [home, -1500]]);

      const spending = await getSpendingByCategory(db, ctx.user.id, range);
      expect(spending).toMatchObject([
        { categoryId: food, spentCents: 3500, hasSubcategorySpending: true },
        { categoryId: home, spentCents: 1500, hasSubcategorySpending: false },
      ]);
      const drill = await getSubcategorySpending(db, ctx.user.id, range, food);
      expect(drill?.map((b) => [b.name, b.spentCents, b.isParentItself])).toEqual([
        ["Veg", 2000, false],
        ["Food", 1500, true],
      ]);
      const breakdown = await getSubcategoryBreakdown(db, ctx.user.id, range);
      expect(breakdown.get(food)).toEqual(drill);
      expect(breakdown.has(home)).toBe(false);
    });

    it("counts a part whose category was deleted as uncategorized", async () => {
      const ctx = await setup();
      const a = await makeCategory(ctx, "A", "#111111");
      const b = await makeCategory(ctx, "B", "#222222");
      const id = await insertRow(ctx, -1000, null);
      await split(ctx, id, [[a, -600], [b, -400]]);
      await db.delete(categories).where(eq(categories.id, b));
      const spending = await getSpendingByCategory(db, ctx.user.id, range);
      expect(spending.map((c) => [c.name, c.spentCents])).toEqual([
        ["A", 600],
        [null, 400],
      ]);
    });

    it("splits an inflow without touching the outflow chart", async () => {
      const ctx = await setup();
      const a = await makeCategory(ctx, "A", "#111111");
      const id = await insertRow(ctx, 10000, null);
      await split(ctx, id, [[a, 6000], [a, 4000]]);
      expect(await getSpendingByCategory(db, ctx.user.id, range)).toEqual([]);
      expect(await getMonthTotals(db, ctx.user.id, range)).toMatchObject({ incomeCents: 10000, count: 1 });
    });

    it("still excludes internal transfers and honors the account scope", async () => {
      const ctx = await setup();
      const a = await makeCategory(ctx, "A", "#111111");
      const out = await insertRow(ctx, -2500, a);
      const inn = await insertRow(ctx, 2500, null);
      await db.insert(transfers).values({ userId: ctx.user.id, outTransactionId: out, inTransactionId: inn, status: "confirmed" });
      const id = await insertRow(ctx, -1000, null);
      await split(ctx, id, [[a, -600], [a, -400]]);

      expect((await getSpendingByCategory(db, ctx.user.id, range)).map((c) => c.spentCents)).toEqual([1000]);
      expect(await getSpendingByCategory(db, ctx.user.id, range, { accountId: ctx.account.id })).toHaveLength(1);
      expect(await getSpendingByCategory(db, ctx.user.id, range, { accountId: "00000000-0000-4000-8000-000000000000" })).toEqual([]);
    });
  });
  describe("getDailySpending", () => {
    it("sums outflows per day over the given accounts, skipping income, transfers and other users", async () => {
      const ctx = await setup();
      const other = await setup();
      await seed(ctx, [
        { date: "2025-09-02", amountCents: -1000 },
        { date: "2025-09-02", amountCents: -250 },
        { date: "2025-09-05", amountCents: -400 },
        { date: "2025-09-05", amountCents: 90000 },
        { date: "2025-09-07", amountCents: -2500 },
        { date: "2025-09-07", amountCents: 2500 },
        { date: "2025-10-01", amountCents: -999 },
      ]);
      await seed(other, [{ date: "2025-09-02", amountCents: -7777 }]);
      const rows = await db.select().from(transactions).where(eq(transactions.date, "2025-09-07"));
      const out = rows.find((r) => r.amountCents < 0)!.id;
      const inn = rows.find((r) => r.amountCents > 0)!.id;
      await db.insert(transfers).values({ userId: ctx.user.id, outTransactionId: out, inTransactionId: inn, status: "confirmed" });

      expect(await getDailySpending(db, ctx.user.id, monthRange("2025-09"), [ctx.account.id])).toEqual([
        { date: "2025-09-02", spentCents: 1250 },
        { date: "2025-09-05", spentCents: 400 },
      ]);
    });

    it("is empty for no accounts or accounts that are not the user's", async () => {
      const ctx = await setup();
      await seed(ctx, [{ date: "2025-09-02", amountCents: -1000 }]);
      expect(await getDailySpending(db, ctx.user.id, monthRange("2025-09"), [])).toEqual([]);
      expect(await getDailySpending(db, ctx.user.id, monthRange("2025-09"), ["00000000-0000-4000-8000-000000000000"])).toEqual([]);
    });
  });

  describe("getReceivedIncome", () => {
    it("lists inflows of the range on the given accounts, oldest first, without transfers, ignored rows or other users", async () => {
      const ctx = await setup();
      const other = await setup();
      await seed(ctx, [
        { date: "2025-09-20", amountCents: 5000 },
        { date: "2025-09-05", amountCents: 241200 },
        { date: "2025-09-06", amountCents: -999 },
        { date: "2025-09-07", amountCents: 700 },
        { date: "2025-09-08", amountCents: 700 },
        { date: "2025-09-09", amountCents: 3300 },
        { date: "2025-10-01", amountCents: 12345 },
      ]);
      await seed(other, [{ date: "2025-09-05", amountCents: 8888 }]);
      // A transfer pair (+700 in, -700 out) and an ignored inflow are not income.
      await seed(ctx, [{ date: "2025-09-07", amountCents: -700 }]);
      const rows = await db.select().from(transactions).where(eq(transactions.userId, ctx.user.id));
      const at = (date: string, cents: number) => rows.find((r) => r.date === date && r.amountCents === cents)!;
      const out = at("2025-09-07", -700);
      await db.insert(transfers).values({ userId: ctx.user.id, outTransactionId: out.id, inTransactionId: at("2025-09-07", 700).id, status: "confirmed" });
      await db.update(transactions).set({ ignoredAt: new Date() }).where(eq(transactions.id, at("2025-09-09", 3300).id));

      const got = await getReceivedIncome(db, ctx.user.id, monthRange("2025-09"), [ctx.account.id]);
      expect(got.map((r) => [r.date, r.amountCents])).toEqual([
        ["2025-09-05", 241200],
        ["2025-09-08", 700],
        ["2025-09-20", 5000],
      ]);
    });

    it("returns the label and the recurring link", async () => {
      const ctx = await setup();
      await seed(ctx, [{ date: "2025-09-05", amountCents: 1000 }]);
      const [row] = await getReceivedIncome(db, ctx.user.id, monthRange("2025-09"), [ctx.account.id]);
      expect(row.label).toMatch(/^ROW \d+$/);
      expect(row.recurringId).toBeNull();
    });

    it("is empty for no accounts or accounts that are not the user's", async () => {
      const ctx = await setup();
      await seed(ctx, [{ date: "2025-09-05", amountCents: 1000 }]);
      expect(await getReceivedIncome(db, ctx.user.id, monthRange("2025-09"), [])).toEqual([]);
      expect(await getReceivedIncome(db, ctx.user.id, monthRange("2025-09"), ["00000000-0000-4000-8000-000000000000"])).toEqual([]);
    });
  });
});
