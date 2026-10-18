// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { normalizeLabel } from "../../lib/import/normalize-label";
import { yearRange } from "../../lib/year/year";
import { db } from "../client";
import { categories, imports, transactions, transfers } from "../schema";
import { createTestUser, resetDb, seedCategories } from "../test-utils";
import { listAccounts } from "./accounts";
import { getMonthTotals, UNCATEGORIZED_COLOR } from "./dashboard";
import { provisionUserDefaults } from "./provision";
import { saveSplit } from "./splits";
import { getCategorySpendingByMonth, getFirstMonthWithData, getIncomeBySource, getYearsWithData } from "./year";

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

async function insertRow(ctx: Ctx, date: string, amountCents: number, categoryId: string | null = null): Promise<string> {
  seq += 1;
  const [row] = await db
    .insert(transactions)
    .values({
      userId: ctx.user.id,
      accountId: ctx.account.id,
      importId: ctx.importId,
      date,
      amountCents,
      labelRaw: `Y ${seq}`,
      labelNormalized: normalizeLabel(`Y ${seq}`),
      labelDisplay: `Y ${seq}`,
      categoryId,
      dedupeHash: `year-hash-${seq}`,
      occurrenceIndex: 0,
    })
    .returning({ id: transactions.id });
  return row.id;
}

async function makeCategory(ctx: Ctx, name: string, color: string, parentId?: string): Promise<string> {
  const [cat] = await db
    .insert(categories)
    .values({ userId: ctx.user.id, name, color, parentId: parentId ?? null })
    .returning();
  return cat.id;
}

const OTHER_ACCOUNT = "00000000-0000-4000-8000-000000000000";

describe("year queries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe("getCategorySpendingByMonth", () => {
    it("groups outflows by top-level category and month, positive, uncategorized named", async () => {
      const ctx = await setup();
      const food = await makeCategory(ctx, "Food", "#111111");
      const sub = await makeCategory(ctx, "Groceries", "#222222", food);
      await insertRow(ctx, "2025-01-05", -1000, food);
      await insertRow(ctx, "2025-01-20", -500, sub);
      await insertRow(ctx, "2025-03-01", -700, food);
      await insertRow(ctx, "2025-03-02", -300, null);
      await insertRow(ctx, "2025-03-03", 9999, food); // inflow ignored
      await insertRow(ctx, "2024-12-31", -111, food); // other year
      await insertRow(ctx, "2026-01-01", -222, food);

      const rows = await getCategorySpendingByMonth(db, ctx.user.id, 2025);
      const pick = (id: string | null, month: string) => rows.find((r) => r.categoryId === id && r.month === month);
      expect(pick(food, "2025-01")?.spentCents).toBe(1500);
      expect(pick(food, "2025-01")?.name).toBe("Food");
      expect(pick(food, "2025-03")?.spentCents).toBe(700);
      expect(pick(null, "2025-03")).toMatchObject({ name: null, color: UNCATEGORIZED_COLOR, spentCents: 300 });
      expect(rows).toHaveLength(3);
    });

    it("counts split parts in their own categories", async () => {
      const ctx = await setup();
      const a = await makeCategory(ctx, "A", "#111111");
      const b = await makeCategory(ctx, "B", "#222222");
      const id = await insertRow(ctx, "2025-06-10", -1000, a);
      const result = await saveSplit(db, ctx.user.id, id, [
        { categoryId: a, amountCents: -600 },
        { categoryId: b, amountCents: -400 },
      ]);
      if (!result.ok) throw new Error(result.error);
      const rows = await getCategorySpendingByMonth(db, ctx.user.id, 2025);
      expect(rows.find((r) => r.categoryId === a)?.spentCents).toBe(600);
      expect(rows.find((r) => r.categoryId === b)?.spentCents).toBe(400);
    });

    it("excludes internal transfers, other users, and honors the account scope", async () => {
      const ctx = await setup();
      const other = await setup();
      const a = await makeCategory(ctx, "A", "#111111");
      const out = await insertRow(ctx, "2025-02-01", -2500, a);
      const inn = await insertRow(ctx, "2025-02-01", 2500, null);
      await db.insert(transfers).values({ userId: ctx.user.id, outTransactionId: out, inTransactionId: inn, status: "confirmed" });
      await insertRow(ctx, "2025-02-02", -100, a);
      await insertRow(other, "2025-02-02", -9000, null);

      const rows = await getCategorySpendingByMonth(db, ctx.user.id, 2025);
      expect(rows.map((r) => r.spentCents)).toEqual([100]);
      expect(await getCategorySpendingByMonth(db, ctx.user.id, 2025, { accountId: ctx.account.id })).toHaveLength(1);
      expect(await getCategorySpendingByMonth(db, ctx.user.id, 2025, { accountId: OTHER_ACCOUNT })).toEqual([]);
    });

    it("month columns add up to the year's spent total", async () => {
      const ctx = await setup();
      const a = await makeCategory(ctx, "A", "#111111");
      await insertRow(ctx, "2025-01-01", -100, a);
      await insertRow(ctx, "2025-07-15", -250, null);
      await insertRow(ctx, "2025-12-31", -50, a);
      await insertRow(ctx, "2025-12-31", 5000, null);
      const rows = await getCategorySpendingByMonth(db, ctx.user.id, 2025);
      const totals = await getMonthTotals(db, ctx.user.id, yearRange(2025));
      expect(rows.reduce((s, r) => s + r.spentCents, 0)).toBe(totals.spentCents);
    });
  });

  describe("getIncomeBySource", () => {
    it("sums inflows per top-level category, sorted desc, splits per part", async () => {
      const ctx = await setup();
      const other = await setup();
      const salary = await makeCategory(ctx, "Salary", "#111111");
      const gifts = await makeCategory(ctx, "Gifts", "#222222");
      await insertRow(ctx, "2025-01-31", 200000, salary);
      await insertRow(ctx, "2025-02-28", 200000, salary);
      await insertRow(ctx, "2025-03-01", 5000, null);
      await insertRow(ctx, "2025-03-02", -999, salary); // outflow ignored
      await insertRow(other, "2025-03-02", 77777, null);
      const id = await insertRow(ctx, "2025-04-01", 1000, gifts);
      const result = await saveSplit(db, ctx.user.id, id, [
        { categoryId: gifts, amountCents: 600 },
        { categoryId: salary, amountCents: 400 },
      ]);
      if (!result.ok) throw new Error(result.error);

      const rows = await getIncomeBySource(db, ctx.user.id, yearRange(2025));
      expect(rows.map((r) => [r.name, r.amountCents])).toEqual([
        ["Salary", 400400],
        [null, 5000],
        ["Gifts", 600],
      ]);
    });

    it("excludes transfers and honors account scope", async () => {
      const ctx = await setup();
      const out = await insertRow(ctx, "2025-02-01", -2500);
      const inn = await insertRow(ctx, "2025-02-01", 2500);
      await db.insert(transfers).values({ userId: ctx.user.id, outTransactionId: out, inTransactionId: inn, status: "confirmed" });
      await insertRow(ctx, "2025-02-02", 300);
      expect((await getIncomeBySource(db, ctx.user.id, yearRange(2025))).map((r) => r.amountCents)).toEqual([300]);
      expect(await getIncomeBySource(db, ctx.user.id, yearRange(2025), { accountId: OTHER_ACCOUNT })).toEqual([]);
    });
  });

  describe("getFirstMonthWithData", () => {
    it("returns the earliest month within the year, or null", async () => {
      const ctx = await setup();
      const other = await setup();
      await insertRow(ctx, "2024-12-31", -1);
      await insertRow(ctx, "2025-03-15", -1);
      await insertRow(ctx, "2025-09-01", -1);
      await insertRow(other, "2025-01-01", -1);
      expect(await getFirstMonthWithData(db, ctx.user.id, 2025)).toBe("2025-03");
      expect(await getFirstMonthWithData(db, ctx.user.id, 2023)).toBeNull();
      expect(await getFirstMonthWithData(db, ctx.user.id, 2025, { accountId: OTHER_ACCOUNT })).toBeNull();
    });
  });

  describe("getYearsWithData", () => {
    it("lists distinct years ascending for the user and account", async () => {
      const ctx = await setup();
      const other = await setup();
      await insertRow(ctx, "2026-01-01", -1);
      await insertRow(ctx, "2024-06-01", -1);
      await insertRow(ctx, "2024-07-01", -1);
      await insertRow(other, "2019-01-01", -1);
      expect(await getYearsWithData(db, ctx.user.id)).toEqual([2024, 2026]);
      expect(await getYearsWithData(db, ctx.user.id, { accountId: ctx.account.id })).toEqual([2024, 2026]);
      expect(await getYearsWithData(db, ctx.user.id, { accountId: OTHER_ACCOUNT })).toEqual([]);
    });
  });
});
