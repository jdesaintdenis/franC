// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { dedupeKey, prepareImport } from "../../lib/import";
import { db } from "../client";
import { categories, imports, transactions, transactionSplits, transfers } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { createAccount, deleteAccount, listAccounts } from "./accounts";
import { applyBankMappings, reapplyBankMapping, upsertBankMapping } from "./bank-categories";
import { applyRulesToUncategorized, createRule } from "./category-rules";
import { createCategory, deleteCategory, getCategoryUsage } from "./categories";
import { commitImport, loadExistingDedupeKeys, undoImport } from "./imports";
import { provisionUserDefaults } from "./provision";
import { getSplit, removeSplit, saveSplit } from "./splits";
import {
  bulkSetTransactionCategory,
  countTransactions,
  listTransactions,
} from "./transactions";
import { linkTransfer, listTransferCandidates, refreshTransfers } from "./transfers";
import { parseTransactionFilters } from "../../lib/transactions/filters";

const sampleText = readFileSync(join(process.cwd(), "docs/samples/sample-export.csv"), "utf-8");

let hashCounter = 0;

interface Row {
  date?: string;
  amountCents: number;
  label?: string;
  categoryId?: string;
  categorySource?: "manual" | "rule" | "bank";
  bankCategory?: string;
  accountId?: string;
}

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

async function seed(ctx: Ctx, rows: Row[]): Promise<string[]> {
  const inserted = await db
    .insert(transactions)
    .values(
      rows.map((r) => ({
        userId: ctx.user.id,
        accountId: r.accountId ?? ctx.main.id,
        importId: ctx.importId,
        date: r.date ?? "2026-03-10",
        amountCents: r.amountCents,
        labelRaw: r.label ?? "SHOP",
        labelNormalized: (r.label ?? "SHOP").toLowerCase(),
        labelDisplay: r.label ?? "SHOP",
        categoryId: r.categoryId ?? null,
        categorySource: r.categorySource ?? null,
        bankCategory: r.bankCategory ?? null,
        dedupeHash: `s${hashCounter++}`,
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

/** Splits an outflow of -4450 into -3210 and -1240. */
async function splitTwo(userId: string, id: string, a: string, b: string, first = -3210, second = -1240) {
  const result = await saveSplit(db, userId, id, [
    { categoryId: a, amountCents: first },
    { categoryId: b, amountCents: second },
  ]);
  if (!result.ok) throw new Error(result.error);
  return result;
}

async function partCount(userId: string, transactionId: string) {
  return (
    await db
      .select()
      .from(transactionSplits)
      .where(and(eq(transactionSplits.userId, userId), eq(transactionSplits.transactionId, transactionId)))
  ).length;
}

describe("saveSplit / getSplit / removeSplit", () => {
  beforeEach(resetDb);

  it("saves parts in order and leaves the transaction untouched", async () => {
    const ctx = await setup();
    const groceries = await category(ctx.user.id, "Groceries");
    const household = await category(ctx.user.id, "Household");
    const [id] = await seed(ctx, [{ amountCents: -4450, categoryId: groceries, categorySource: "manual" }]);

    const saved = await splitTwo(ctx.user.id, id, household, groceries);
    expect(saved.parts.map((p) => [p.category?.name, p.amountCents])).toEqual([
      ["Household", -3210],
      ["Groceries", -1240],
    ]);

    const detail = await getSplit(db, ctx.user.id, id);
    expect(detail).toMatchObject({ transactionId: id, amountCents: -4450 });
    expect(detail?.parts).toHaveLength(2);

    const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
    expect(row).toMatchObject({ amountCents: -4450, categoryId: groceries, categorySource: "manual" });
  });

  it("replaces all parts on a second save", async () => {
    const ctx = await setup();
    const a = await category(ctx.user.id, "A");
    const b = await category(ctx.user.id, "B");
    const c = await category(ctx.user.id, "C");
    const [id] = await seed(ctx, [{ amountCents: -1000 }]);
    await splitTwo(ctx.user.id, id, a, b, -600, -400);

    const again = await saveSplit(db, ctx.user.id, id, [
      { categoryId: c, amountCents: -100 },
      { categoryId: a, amountCents: -200 },
      { categoryId: b, amountCents: -700 },
    ]);
    expect(again.ok).toBe(true);
    const detail = await getSplit(db, ctx.user.id, id);
    expect(detail?.parts.map((p) => [p.category?.name, p.amountCents])).toEqual([
      ["C", -100],
      ["A", -200],
      ["B", -700],
    ]);
    expect(await partCount(ctx.user.id, id)).toBe(3);
  });

  it("removes a split: the row returns to its previous category; removing again is a no-op", async () => {
    const ctx = await setup();
    const groceries = await category(ctx.user.id, "Groceries");
    const other = await category(ctx.user.id, "Other");
    const [id] = await seed(ctx, [{ amountCents: -4450, categoryId: groceries, categorySource: "rule" }]);
    await splitTwo(ctx.user.id, id, other, other);

    const removed = await removeSplit(db, ctx.user.id, id);
    expect(removed).toMatchObject({
      ok: true,
      removed: true,
      category: { id: groceries, name: "Groceries" },
      categorySource: "rule",
    });
    expect(await partCount(ctx.user.id, id)).toBe(0);
    expect(await removeSplit(db, ctx.user.id, id)).toMatchObject({ ok: true, removed: false });
    expect((await getSplit(db, ctx.user.id, id))?.parts).toEqual([]);
  });

  it("returns validation codes", async () => {
    const ctx = await setup();
    const a = await category(ctx.user.id, "A");
    const [out, inflow] = await seed(ctx, [{ amountCents: -1000 }, { amountCents: 1000 }]);
    const err = async (id: string, parts: { categoryId: string | null; amountCents: number }[]) => {
      const r = await saveSplit(db, ctx.user.id, id, parts);
      return r.ok ? "ok" : r.error;
    };
    expect(await err(out, [{ categoryId: a, amountCents: -1000 }])).toBe("too_few_parts");
    expect(await err(out, Array.from({ length: 21 }, () => ({ categoryId: a, amountCents: -1 })))).toBe("too_many_parts");
    expect(await err(out, [{ categoryId: null, amountCents: -500 }, { categoryId: a, amountCents: -500 }])).toBe("missing_category");
    expect(await err(out, [{ categoryId: a, amountCents: 0 }, { categoryId: a, amountCents: -1000 }])).toBe("invalid_amount");
    expect(await err(out, [{ categoryId: a, amountCents: 500 }, { categoryId: a, amountCents: -1500 }])).toBe("invalid_amount");
    expect(await err(out, [{ categoryId: a, amountCents: -500 }, { categoryId: a, amountCents: -499 }])).toBe("sum_mismatch");
    expect(await err(inflow, [{ categoryId: a, amountCents: -500 }, { categoryId: a, amountCents: 1500 }])).toBe("invalid_amount");
    expect(await err(inflow, [{ categoryId: a, amountCents: 500 }, { categoryId: a, amountCents: 500 }])).toBe("ok");
    // A failed save changes nothing.
    expect(await partCount(ctx.user.id, out)).toBe(0);
  });

  it("refuses another user's transaction or category, and unknown ids", async () => {
    const one = await setup();
    const two = await setup();
    const mine = await category(one.user.id, "Mine");
    const theirs = await category(two.user.id, "Theirs");
    const [myTx] = await seed(one, [{ amountCents: -1000 }]);
    const [theirTx] = await seed(two, [{ amountCents: -1000 }]);
    const parts = (a: string, b: string) => [
      { categoryId: a, amountCents: -500 },
      { categoryId: b, amountCents: -500 },
    ];

    expect(await saveSplit(db, one.user.id, theirTx, parts(mine, mine))).toEqual({ ok: false, error: "not_found" });
    expect(await saveSplit(db, one.user.id, myTx, parts(mine, theirs))).toEqual({ ok: false, error: "category_not_found" });
    expect(await saveSplit(db, one.user.id, "00000000-0000-4000-8000-000000000000", parts(mine, mine))).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await getSplit(db, one.user.id, theirTx)).toBeNull();
    expect(await removeSplit(db, one.user.id, theirTx)).toEqual({ ok: false, error: "not_found" });

    await splitTwoSafe(two, theirTx, theirs);
    expect(await removeSplit(db, one.user.id, theirTx)).toEqual({ ok: false, error: "not_found" });
    expect(await partCount(two.user.id, theirTx)).toBe(2);
  });

  it("refuses a row in a transfer", async () => {
    const ctx = await setup();
    const a = await category(ctx.user.id, "A");
    const [out] = await seed(ctx, [{ amountCents: -5000 }]);
    const [inn] = await seed(ctx, [{ amountCents: 5000, accountId: ctx.savings.id }]);
    expect((await linkTransfer(db, ctx.user.id, out, inn)).ok).toBe(true);
    for (const id of [out, inn]) {
      const sign = id === out ? -1 : 1;
      expect(
        await saveSplit(db, ctx.user.id, id, [
          { categoryId: a, amountCents: sign * 2500 },
          { categoryId: a, amountCents: sign * 2500 },
        ]),
      ).toEqual({ ok: false, error: "in_transfer" });
    }
  });
});

async function splitTwoSafe(ctx: Ctx, id: string, cat: string) {
  await splitTwo(ctx.user.id, id, cat, cat, -500, -500);
}

describe("splits and internal transfers", () => {
  beforeEach(resetDb);

  it("linkTransfer refuses a split row; the split survives", async () => {
    const ctx = await setup();
    const a = await category(ctx.user.id, "A");
    const [out] = await seed(ctx, [{ amountCents: -5000 }]);
    const [inn] = await seed(ctx, [{ amountCents: 5000, accountId: ctx.savings.id }]);
    await splitTwo(ctx.user.id, out, a, a, -2500, -2500);

    expect(await linkTransfer(db, ctx.user.id, out, inn)).toEqual({ ok: false, error: "split" });
    expect(await linkTransfer(db, ctx.user.id, inn, out)).toEqual({ ok: false, error: "split" });
    expect(await db.select().from(transfers)).toHaveLength(0);
    expect(await partCount(ctx.user.id, out)).toBe(2);
  });

  it("refreshTransfers skips split rows and pairs them again once unsplit", async () => {
    const ctx = await setup();
    const a = await category(ctx.user.id, "A");
    const [out] = await seed(ctx, [{ amountCents: -5000 }]);
    await seed(ctx, [{ amountCents: 5000, accountId: ctx.savings.id }]);
    await splitTwo(ctx.user.id, out, a, a, -2500, -2500);

    expect(await refreshTransfers(db, ctx.user.id)).toBe(0);
    expect(await db.select().from(transfers)).toHaveLength(0);

    await removeSplit(db, ctx.user.id, out);
    expect(await refreshTransfers(db, ctx.user.id)).toBe(1);
  });

  it("listTransferCandidates leaves split rows out, and is empty for a split source", async () => {
    const ctx = await setup();
    const a = await category(ctx.user.id, "A");
    const [out] = await seed(ctx, [{ amountCents: -5000 }]);
    const [inn] = await seed(ctx, [{ amountCents: 5000, accountId: ctx.savings.id }]);

    expect((await listTransferCandidates(db, ctx.user.id, out))?.map((c) => c.id)).toEqual([inn]);
    await splitTwo(ctx.user.id, inn, a, a, 2500, 2500);
    expect(await listTransferCandidates(db, ctx.user.id, out)).toEqual([]);
    expect(await listTransferCandidates(db, ctx.user.id, inn)).toEqual([]);
  });
});

describe("splits and imports", () => {
  beforeEach(resetDb);

  async function importSample(userId: string, accountId: string) {
    const prepared = prepareImport(sampleText, accountId);
    if (!prepared.ok) throw new Error(prepared.fileError);
    const existing = await loadExistingDedupeKeys(db, userId, accountId, prepared.transactions.map((t) => t.dedupeHash));
    const fresh = prepared.transactions.filter((t) => !existing.has(dedupeKey(t)));
    const result = await commitImport(db, {
      userId,
      accountId,
      filename: "export.csv",
      rowsTotal: prepared.rowsTotal,
      rowsError: prepared.errors.length,
      transactions: fresh,
    });
    return { record: result.import, total: prepared.transactions.length };
  }

  it("undoing the import removes its splits", async () => {
    const ctx = await setup();
    const a = await category(ctx.user.id, "A");
    const { record } = await importSample(ctx.user.id, ctx.main.id);
    const [debit] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, ctx.user.id), eq(transactions.amountCents, -4299)));
    await splitTwo(ctx.user.id, debit.id, a, a, -4000, -299);
    expect(await db.select().from(transactionSplits)).toHaveLength(2);

    await undoImport(db, ctx.user.id, record.id);
    expect(await db.select().from(transactionSplits)).toHaveLength(0);
  });

  it("deleting an account removes the splits of its transactions", async () => {
    const ctx = await setup();
    const a = await category(ctx.user.id, "A");
    const [id] = await seed(ctx, [{ amountCents: -1000, accountId: ctx.savings.id }]);
    await splitTwo(ctx.user.id, id, a, a, -600, -400);
    expect((await deleteAccount(db, ctx.user.id, ctx.savings.id)).ok).toBe(true);
    expect(await db.select().from(transactionSplits)).toHaveLength(0);
  });

  it("re-importing the same file inserts nothing and keeps the parts", async () => {
    const ctx = await setup();
    const a = await category(ctx.user.id, "A");
    const first = await importSample(ctx.user.id, ctx.main.id);
    const [debit] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, ctx.user.id), eq(transactions.amountCents, -4299)));
    await splitTwo(ctx.user.id, debit.id, a, a, -4000, -299);

    const second = await importSample(ctx.user.id, ctx.main.id);
    expect(second.record.rowsInserted).toBe(0);
    expect(await db.select().from(transactions).where(eq(transactions.userId, ctx.user.id))).toHaveLength(first.total);
    expect(await partCount(ctx.user.id, debit.id)).toBe(2);
  });
});

describe("automatic categorization leaves split rows alone", () => {
  beforeEach(resetDb);

  it("rules skip split rows (candidates and updates)", async () => {
    const ctx = await setup();
    const shop = await category(ctx.user.id, "Shop");
    const a = await category(ctx.user.id, "A");
    const [split, plain] = await seed(ctx, [{ amountCents: -1000, label: "SHOP" }, { amountCents: -1000, label: "SHOP" }]);
    await splitTwo(ctx.user.id, split, a, a, -600, -400);
    await createRule(db, ctx.user.id, { categoryId: shop, matchType: "contains", pattern: "shop" });

    const result = await applyRulesToUncategorized(db, ctx.user.id);
    expect(result.byCategory[shop]).toEqual([plain]);
    const [row] = await db.select().from(transactions).where(eq(transactions.id, split));
    expect(row).toMatchObject({ categoryId: null, categorySource: null });
  });

  it("bank mappings skip split rows on apply and re-apply", async () => {
    const ctx = await setup();
    const mapped = await category(ctx.user.id, "Mapped");
    const a = await category(ctx.user.id, "A");
    const [split, plain] = await seed(ctx, [
      { amountCents: -1000, bankCategory: "Food" },
      { amountCents: -1000, bankCategory: "Food" },
    ]);
    await splitTwo(ctx.user.id, split, a, a, -600, -400);
    await upsertBankMapping(db, ctx.user.id, { bankCategory: "Food", bankSubcategory: null, categoryId: mapped });

    expect(await applyBankMappings(db, ctx.user.id)).toBe(1);
    const own = async (id: string) => (await db.select().from(transactions).where(eq(transactions.id, id)))[0];
    expect(await own(split)).toMatchObject({ categoryId: null, categorySource: null });
    expect(await own(plain)).toMatchObject({ categoryId: mapped, categorySource: "bank" });

    // Re-apply neither drops nor fills a split row, even one carrying a bank category.
    await db.update(transactions).set({ categoryId: mapped, categorySource: "bank" }).where(eq(transactions.id, split));
    const other = await category(ctx.user.id, "Other");
    await upsertBankMapping(db, ctx.user.id, { bankCategory: "Food", bankSubcategory: null, categoryId: other });
    expect(await reapplyBankMapping(db, ctx.user.id, "Food")).toBe(1);
    expect(await own(split)).toMatchObject({ categoryId: mapped, categorySource: "bank" });
    expect(await own(plain)).toMatchObject({ categoryId: other, categorySource: "bank" });
  });

  it("bulk edit skips split rows and reports the count", async () => {
    const ctx = await setup();
    const target = await category(ctx.user.id, "Target");
    const a = await category(ctx.user.id, "A");
    const [split, plain] = await seed(ctx, [{ amountCents: -1000 }, { amountCents: -1000 }]);
    await splitTwo(ctx.user.id, split, a, a, -600, -400);

    const res = await bulkSetTransactionCategory(db, ctx.user.id, [split, plain], target);
    expect(res).toMatchObject({ updated: 1, skipped: 1, category: { id: target } });
    const rows = await db.select().from(transactions).where(eq(transactions.userId, ctx.user.id));
    expect(rows.find((r) => r.id === split)?.categoryId).toBeNull();
    expect(rows.find((r) => r.id === plain)?.categoryId).toBe(target);

    expect(await bulkSetTransactionCategory(db, ctx.user.id, [split], null)).toMatchObject({ updated: 0, skipped: 1 });
  });
});

describe("category filter and list shape", () => {
  beforeEach(resetDb);

  async function ids(ctx: Ctx, category: string | undefined) {
    const page = await listTransactions(db, ctx.user.id, parseTransactionFilters(category ? { category } : {}), null);
    return page.items.map((i) => i.id).sort();
  }

  it("matches a split row by any part, ignoring its own category; parent covers subcategories", async () => {
    const ctx = await setup();
    const food = await category(ctx.user.id, "Food");
    const veg = await category(ctx.user.id, "Veg", food);
    const home = await category(ctx.user.id, "Home");
    const misc = await category(ctx.user.id, "Misc");
    // The split row's own category (Misc) must be ignored while split.
    const [split, plainFood, plainNone] = await seed(ctx, [
      { amountCents: -4450, categoryId: misc, categorySource: "manual" },
      { amountCents: -100, categoryId: food },
      { amountCents: -100 },
    ]);
    await splitTwo(ctx.user.id, split, veg, home);

    expect(await ids(ctx, food)).toEqual([split, plainFood].sort());
    expect(await ids(ctx, veg)).toEqual([split]);
    expect(await ids(ctx, home)).toEqual([split]);
    expect(await ids(ctx, misc)).toEqual([]);
    expect(await ids(ctx, "none")).toEqual([plainNone]);
    const filters = parseTransactionFilters({ category: home });
    expect(await countTransactions(db, ctx.user.id, filters)).toBe(1);
  });

  it("'none' matches a split row only when a part lost its category", async () => {
    const ctx = await setup();
    const a = await category(ctx.user.id, "A");
    const b = await category(ctx.user.id, "B");
    const [split] = await seed(ctx, [{ amountCents: -1000 }]);
    await splitTwo(ctx.user.id, split, a, b, -600, -400);
    expect(await ids(ctx, "none")).toEqual([]);

    await deleteCategory(db, ctx.user.id, b);
    expect(await ids(ctx, "none")).toEqual([split]);
    expect(await countTransactions(db, ctx.user.id, parseTransactionFilters({ category: "none" }))).toBe(1);
  });

  it("returns split parts by position on each row, null for unsplit rows", async () => {
    const ctx = await setup();
    const food = await category(ctx.user.id, "Food");
    const veg = await category(ctx.user.id, "Veg", food);
    const home = await category(ctx.user.id, "Home");
    const [split, plain] = await seed(ctx, [{ amountCents: -4450, date: "2026-03-11" }, { amountCents: -100 }]);
    await splitTwo(ctx.user.id, split, home, veg);

    const page = await listTransactions(db, ctx.user.id, parseTransactionFilters({}), null);
    const byId = new Map(page.items.map((i) => [i.id, i]));
    expect(byId.get(plain)?.split).toBeNull();
    const parts = byId.get(split)?.split?.parts ?? [];
    expect(parts.map((p) => [p.category, p.amountCents])).toEqual([
      [{ id: home, name: "Home", color: "#112233", icon: null, parentName: null }, -3210],
      [{ id: veg, name: "Veg", color: "#112233", icon: null, parentName: "Food" }, -1240],
    ]);
    expect(parts.every((p) => typeof p.id === "string")).toBe(true);
  });

  it("never shows another user's parts", async () => {
    const one = await setup();
    const two = await setup();
    const a = await category(two.user.id, "A");
    const [theirTx] = await seed(two, [{ amountCents: -1000 }]);
    await splitTwo(two.user.id, theirTx, a, a, -600, -400);
    const page = await listTransactions(db, one.user.id, parseTransactionFilters({}), null);
    expect(page.items).toEqual([]);
  });
});

describe("category delete and usage with splits", () => {
  beforeEach(resetDb);

  it("usage counts distinct transactions, directly or through a part", async () => {
    const ctx = await setup();
    const parent = await category(ctx.user.id, "Parent");
    const child = await category(ctx.user.id, "Child", parent);
    const other = await category(ctx.user.id, "Other");
    const [split, sameTwice, , hiddenOwn] = await seed(ctx, [
      { amountCents: -1000 },
      { amountCents: -1000 },
      { amountCents: -1000, categoryId: child },
      { amountCents: -1000, categoryId: child },
    ]);
    await splitTwo(ctx.user.id, split, child, other, -600, -400);
    await splitTwo(ctx.user.id, sameTwice, child, child, -600, -400);
    // hiddenOwn is split away from `child`: its own category no longer counts.
    await splitTwo(ctx.user.id, hiddenOwn, other, other, -600, -400);

    expect((await getCategoryUsage(db, ctx.user.id, child))?.transactions).toBe(3);
    expect((await getCategoryUsage(db, ctx.user.id, parent))?.subcategoryTransactions).toBe(3);
    expect((await getCategoryUsage(db, ctx.user.id, other))?.transactions).toBe(2);
  });

  it("move_to_parent moves parts too", async () => {
    const ctx = await setup();
    const parent = await category(ctx.user.id, "Parent");
    const child = await category(ctx.user.id, "Child", parent);
    const other = await category(ctx.user.id, "Other");
    const [split, direct] = await seed(ctx, [{ amountCents: -1000 }, { amountCents: -1000, categoryId: child }]);
    await splitTwo(ctx.user.id, split, child, other, -600, -400);

    const result = await deleteCategory(db, ctx.user.id, child, "move_to_parent");
    expect(result).toMatchObject({ ok: true, transactionsMoved: 2 });
    const detail = await getSplit(db, ctx.user.id, split);
    expect(detail?.parts.map((p) => p.category?.id)).toEqual([parent, other]);
    expect((await db.select().from(transactions).where(eq(transactions.id, direct)))[0].categoryId).toBe(parent);
  });

  it("other drop paths set the parts' category to null", async () => {
    const ctx = await setup();
    const a = await category(ctx.user.id, "A");
    const b = await category(ctx.user.id, "B");
    const [split] = await seed(ctx, [{ amountCents: -1000 }]);
    await splitTwo(ctx.user.id, split, a, b, -600, -400);

    const result = await deleteCategory(db, ctx.user.id, a, "uncategorize");
    expect(result).toMatchObject({ ok: true, transactionsUncategorized: 1 });
    const detail = await getSplit(db, ctx.user.id, split);
    expect(detail?.parts.map((p) => p.category?.id ?? null)).toEqual([null, b]);
    // The row is still split, never uncategorized on its own.
    expect(await partCount(ctx.user.id, split)).toBe(2);
  });

  it("deleting a category with subcategories and delete_subcategories nulls their parts", async () => {
    const ctx = await setup();
    const parent = await category(ctx.user.id, "Parent");
    const child = await category(ctx.user.id, "Child", parent);
    const other = await category(ctx.user.id, "Other");
    const [split] = await seed(ctx, [{ amountCents: -1000 }]);
    await splitTwo(ctx.user.id, split, child, other, -600, -400);

    const result = await deleteCategory(db, ctx.user.id, parent, "delete_subcategories");
    expect(result).toMatchObject({ ok: true, transactionsUncategorized: 1, subcategoriesDeleted: 1 });
    expect((await getSplit(db, ctx.user.id, split))?.parts.map((p) => p.category?.id ?? null)).toEqual([null, other]);
    expect(await db.select().from(categories).where(eq(categories.id, child))).toHaveLength(0);
  });
});
