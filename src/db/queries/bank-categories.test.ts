// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNotNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  bankKey,
  buildBankCategoryWrites,
  planBankCategories,
  type BankCategoryWrites,
  type BankDecisions,
} from "../../lib/categorize/bank";
import { prepareImportGuessed } from "../../lib/import/prepare-guessed";
import { db } from "../client";
import { bankCategoryMappings, categories, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { listAccounts } from "./accounts";
import {
  applyBankMappings,
  forgetBankMapping,
  getOwnedBankMapping,
  listBankMappings,
  loadBankPlanContext,
  reapplyBankMapping,
  updateBankMapping,
  upsertBankMapping,
} from "./bank-categories";
import { createCategory } from "./categories";
import { applyRulesToUncategorized, createRule } from "./category-rules";
import { commitImport } from "./imports";
import { provisionUserDefaults } from "./provision";
import { setTransactionCategory } from "./transactions";

const sampleText = readFileSync(join(process.cwd(), "docs/samples/sample-export.csv"), "utf-8");

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [account] = await listAccounts(user.id);
  return { user, account };
}

async function category(userId: string, name: string, parentId: string | null = null) {
  const r = await createCategory(db, userId, { name, color: "#112233", parentId });
  if (!r.ok) throw new Error(r.error);
  return r.category;
}

function prepare(accountId: string, text = sampleText) {
  const result = prepareImportGuessed(text, accountId);
  if (!result.ok) throw new Error(result.fileError);
  return result;
}

/** The server flow: every valid row goes in, decisions are validated against the fresh plan. */
async function runImport(
  userId: string,
  accountId: string,
  decide: (plan: ReturnType<typeof planBankCategories>) => BankDecisions = () => ({}),
) {
  const prepared = prepare(accountId);
  const context = await loadBankPlanContext(db, userId);
  const plan = planBankCategories(prepared.transactions, context.mappings, context.categories);
  const built = buildBankCategoryWrites(plan, decide(plan), context.categories);
  if (!built.ok) throw new Error(built.code);
  return commitImport(db, {
    userId,
    accountId,
    filename: "export.csv",
    rowsTotal: prepared.rowsTotal,
    rowsError: prepared.errors.length,
    transactions: prepared.transactions,
    bankWrites: built.writes satisfies BankCategoryWrites,
  });
}

const rowsOf = (userId: string) => db.select().from(transactions).where(eq(transactions.userId, userId));

describe("bank categories in commitImport", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("stores the cleaned bank categories and categorizes nothing without decisions", async () => {
    const { user, account } = await setup();
    const result = await runImport(user.id, account.id);
    expect(result.rowsBackfilled).toBe(0);

    const rows = await rowsOf(user.id);
    expect(rows.every((r) => r.categoryId === null && r.categorySource === null)).toBe(true);
    // Placeholders ("A categoriser - ...") are not kept.
    expect(rows.some((r) => r.bankCategory?.toLowerCase().startsWith("a categoriser"))).toBe(false);
    expect(rows.filter((r) => r.bankCategory !== null).length).toBeGreaterThan(80);
    expect(await db.select().from(bankCategoryMappings)).toHaveLength(0);
  });

  it("creates, maps and ignores according to the decisions, and skips decided groups next time", async () => {
    const { user, account } = await setup();
    const auto = await category(user.id, "Auto");
    const result = await runImport(user.id, account.id, () => ({
      [bankKey("Alimentation", null)]: { action: "create" },
      [bankKey("Alimentation", "Restaurant")]: { action: "create" },
      [bankKey("Transports", null)]: { action: "map", categoryId: auto.id },
      [bankKey("Loisirs et vacances", null)]: { action: "ignore" },
    }));
    expect(result.import.rowsInserted).toBe(140);

    const [food] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.userId, user.id), eq(categories.name, "Alimentation")));
    expect(food.parentId).toBeNull();
    const [resto] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.userId, user.id), eq(categories.name, "Restaurant")));
    expect(resto.parentId).toBe(food.id);
    // Known top-level bank names get a default emoji; subcategories never do (SPEC §37).
    expect(food.icon).toBe("🛒");
    expect(resto.icon).toBeNull();

    const rows = await rowsOf(user.id);
    for (const r of rows.filter((x) => x.bankCategory === "Alimentation")) {
      expect(r.categorySource).toBe("bank");
      expect(r.categoryId).toBe(r.bankSubcategory === "Restaurant" ? resto.id : food.id);
    }
    for (const r of rows.filter((x) => x.bankCategory === "Transports")) expect(r.categoryId).toBe(auto.id);
    for (const r of rows.filter((x) => x.bankCategory === "Loisirs et vacances")) expect(r.categoryId).toBeNull();

    const mappings = await listBankMappings(db, user.id);
    expect(mappings.find((m) => m.bankCategory === "Loisirs et vacances")).toMatchObject({
      categoryId: null,
      categoryName: null,
    });
    expect(mappings.find((m) => m.bankSubcategory === "Restaurant")).toMatchObject({
      categoryName: "Restaurant",
      categoryParentName: "Alimentation",
    });

    // Next import: decided categories only ask about their new subcategories.
    const context = await loadBankPlanContext(db, user.id);
    const plan = planBankCategories((await rowsOf(user.id)), context.mappings, context.categories);
    for (const name of ["Alimentation", "Transports", "Loisirs et vacances"]) {
      const group = plan.groups.find((g) => g.bankCategory === name);
      expect(group).toMatchObject({ decided: true, category: null });
    }
    // Only its unmapped subcategories are asked about.
    const foodGroup = plan.groups.find((g) => g.bankCategory === "Alimentation");
    expect(foodGroup?.subcategories.map((s) => s.bankSubcategory)).not.toContain("Restaurant");
    expect(plan.groups.find((g) => g.bankCategory === "Logement - maison")?.decided).toBe(false);
  });

  it("re-import inserts nothing, backfills only null bank columns and keeps manual and rule categories", async () => {
    const { user, account } = await setup();
    const prepared = prepare(account.id);
    const first = await runImport(user.id, account.id);
    expect(first.import.rowsInserted).toBe(140);

    // Simulate rows imported before Slice 14: no bank columns.
    const before = await rowsOf(user.id);
    const withBank = before.filter((r) => r.bankCategory !== null);
    await db.update(transactions).set({ bankCategory: null, bankSubcategory: null }).where(eq(transactions.userId, user.id));
    // One row keeps a different, already-set value: it must not be overwritten.
    const kept = withBank[0];
    await db
      .update(transactions)
      .set({ bankCategory: "Elsewhere", bankSubcategory: null })
      .where(eq(transactions.id, kept.id));
    const manualCategory = await category(user.id, "Manual");
    const manualRow = withBank[1];
    await setTransactionCategory(db, user.id, manualRow.id, manualCategory.id);

    const second = await runImport(user.id, account.id);
    expect(second.import.rowsInserted).toBe(0);
    expect(second.import.rowsDuplicate).toBe(prepared.transactions.length);
    expect(second.rowsBackfilled).toBe(withBank.length - 1);

    const after = await rowsOf(user.id);
    expect(after).toHaveLength(140);
    expect(after.find((r) => r.id === kept.id)).toMatchObject({ bankCategory: "Elsewhere", bankSubcategory: null });
    const restored = after.find((r) => r.id === withBank[2].id);
    expect(restored).toMatchObject({ bankCategory: withBank[2].bankCategory, bankSubcategory: withBank[2].bankSubcategory });
    expect(after.find((r) => r.id === manualRow.id)).toMatchObject({
      categoryId: manualCategory.id,
      categorySource: "manual",
    });
    expect(after.filter((r) => r.bankCategory !== null)).toHaveLength(withBank.length);

    // A third run has nothing left to backfill.
    expect((await runImport(user.id, account.id)).rowsBackfilled).toBe(0);
  });

  it("a rule beats the bank mapping at import", async () => {
    const { user, account } = await setup();
    const ruleCat = await category(user.id, "Telecom");
    await createRule(db, user.id, { categoryId: ruleCat.id, matchType: "contains", pattern: "horizon" });
    await runImport(user.id, account.id, () => ({
      [bankKey("Logement - maison", null)]: { action: "create" },
    }));
    const rows = await rowsOf(user.id);
    const telecom = rows.filter((r) => r.labelNormalized?.includes("HORIZON"));
    expect(telecom.length).toBeGreaterThan(0);
    expect(telecom.every((r) => r.categoryId === ruleCat.id && r.categorySource === "rule")).toBe(true);
    const otherLogement = rows.filter((r) => r.bankCategory === "Logement - maison" && !telecom.includes(r));
    expect(otherLogement.length).toBeGreaterThan(0);
    expect(otherLogement.every((r) => r.categorySource === "bank")).toBe(true);
  });

  it("newly mapped bank categories also categorize older uncategorized rows", async () => {
    const { user, account } = await setup();
    await runImport(user.id, account.id);
    const auto = await category(user.id, "Auto");
    const result = await runImport(user.id, account.id, () => ({
      [bankKey("Transports", null)]: { action: "map", categoryId: auto.id },
    }));
    expect(result.import.rowsInserted).toBe(0);
    const transports = (await rowsOf(user.id)).filter((r) => r.bankCategory === "Transports");
    expect(transports.length).toBeGreaterThan(0);
    expect(transports.every((r) => r.categoryId === auto.id && r.categorySource === "bank")).toBe(true);
  });
});

describe("rules and bank categories", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rules replace bank categories retroactively but never manual or rule ones", async () => {
    const { user, account } = await setup();
    const auto = await category(user.id, "Auto");
    await runImport(user.id, account.id, () => ({ [bankKey("Transports", null)]: { action: "map", categoryId: auto.id } }));
    const rows = (await rowsOf(user.id)).filter((r) => r.bankCategory === "Transports");
    expect(rows.length).toBeGreaterThan(2);
    const [manualRow, ruleRow, bankRow] = rows;
    const manualCat = await category(user.id, "Manual");
    await setTransactionCategory(db, user.id, manualRow.id, manualCat.id);
    const other = await category(user.id, "Other rule");
    await db
      .update(transactions)
      .set({ categoryId: other.id, categorySource: "rule" })
      .where(eq(transactions.id, ruleRow.id));

    const ruleCat = await category(user.id, "Everything");
    await createRule(db, user.id, { categoryId: ruleCat.id, matchType: "regex", pattern: ".*" });
    await applyRulesToUncategorized(db, user.id);

    const after = new Map((await rowsOf(user.id)).map((r) => [r.id, r]));
    expect(after.get(bankRow.id)).toMatchObject({ categoryId: ruleCat.id, categorySource: "rule" });
    expect(after.get(manualRow.id)).toMatchObject({ categoryId: manualCat.id, categorySource: "manual" });
    expect(after.get(ruleRow.id)).toMatchObject({ categoryId: other.id, categorySource: "rule" });
  });
});

describe("bank mapping queries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function importedWithoutMappings() {
    const ctx = await setup();
    await runImport(ctx.user.id, ctx.account.id);
    return ctx;
  }

  it("applyBankMappings fills only uncategorized rows and can be limited to one bank category", async () => {
    const { user } = await importedWithoutMappings();
    const auto = await category(user.id, "Auto");
    const food = await category(user.id, "Food");
    await upsertBankMapping(db, user.id, { bankCategory: "Transports", bankSubcategory: null, categoryId: auto.id });
    await upsertBankMapping(db, user.id, { bankCategory: "Alimentation", bankSubcategory: null, categoryId: food.id });

    const transports = (await rowsOf(user.id)).filter((r) => r.bankCategory === "Transports");
    await setTransactionCategory(db, user.id, transports[0].id, food.id);

    const done = await db.transaction((tx) => applyBankMappings(tx, user.id, { bankCategory: "Transports" }));
    expect(done).toBe(transports.length - 1);
    const rows = await rowsOf(user.id);
    expect(rows.find((r) => r.id === transports[0].id)?.categorySource).toBe("manual");
    expect(rows.filter((r) => r.bankCategory === "Alimentation").every((r) => r.categoryId === null)).toBe(true);

    await db.transaction((tx) => applyBankMappings(tx, user.id));
    expect(
      (await rowsOf(user.id)).filter((r) => r.bankCategory === "Alimentation").every((r) => r.categoryId === food.id),
    ).toBe(true);
  });

  it("a subcategory mapping wins over its category, and Ignore falls back to the category", async () => {
    const { user } = await importedWithoutMappings();
    const food = await category(user.id, "Food");
    const fast = await category(user.id, "Fast food");
    await upsertBankMapping(db, user.id, { bankCategory: "Alimentation", bankSubcategory: null, categoryId: food.id });
    await upsertBankMapping(db, user.id, { bankCategory: "Alimentation", bankSubcategory: "Restauration rapide", categoryId: fast.id });
    await upsertBankMapping(db, user.id, { bankCategory: "Alimentation", bankSubcategory: "Restaurant", categoryId: null });
    await db.transaction((tx) => applyBankMappings(tx, user.id));
    const rows = (await rowsOf(user.id)).filter((r) => r.bankCategory === "Alimentation");
    for (const r of rows) {
      expect(r.categoryId).toBe(r.bankSubcategory === "Restauration rapide" ? fast.id : food.id);
    }
  });

  it("changing a mapping re-applies it to bank rows only", async () => {
    const { user } = await importedWithoutMappings();
    const auto = await category(user.id, "Auto");
    const car = await category(user.id, "Car");
    await upsertBankMapping(db, user.id, { bankCategory: "Transports", bankSubcategory: null, categoryId: auto.id });
    await db.transaction((tx) => applyBankMappings(tx, user.id));
    const transports = (await rowsOf(user.id)).filter((r) => r.bankCategory === "Transports");
    await setTransactionCategory(db, user.id, transports[0].id, auto.id);

    const changed = await updateBankMapping(db, user.id, { bankCategory: "Transports", bankSubcategory: null, categoryId: car.id });
    expect(changed).toEqual({ ok: true, rowsUpdated: transports.length - 1 });
    const rows = await rowsOf(user.id);
    expect(rows.find((r) => r.id === transports[0].id)).toMatchObject({ categoryId: auto.id, categorySource: "manual" });
    expect(rows.find((r) => r.id === transports[1].id)).toMatchObject({ categoryId: car.id, categorySource: "bank" });

    // Ignoring it clears the bank rows again.
    await updateBankMapping(db, user.id, { bankCategory: "Transports", bankSubcategory: null, categoryId: null });
    const cleared = (await rowsOf(user.id)).filter((r) => r.bankCategory === "Transports" && r.id !== transports[0].id);
    expect(cleared.every((r) => r.categoryId === null && r.categorySource === null)).toBe(true);
    expect(await db.transaction((tx) => reapplyBankMapping(tx, user.id, "Transports"))).toBe(0);
  });

  it("forgets a mapping, and deleting a category forgets its mappings", async () => {
    const { user } = await importedWithoutMappings();
    const auto = await category(user.id, "Auto");
    const food = await category(user.id, "Food");
    await upsertBankMapping(db, user.id, { bankCategory: "Transports", bankSubcategory: null, categoryId: auto.id });
    await upsertBankMapping(db, user.id, { bankCategory: "Alimentation", bankSubcategory: null, categoryId: food.id });
    const [transports] = (await listBankMappings(db, user.id)).filter((m) => m.bankCategory === "Transports");
    expect(await forgetBankMapping(db, user.id, transports.id)).toBe(true);
    expect(await forgetBankMapping(db, user.id, transports.id)).toBe(false);

    await db.delete(categories).where(eq(categories.id, food.id));
    expect(await listBankMappings(db, user.id)).toEqual([]);
  });

  it("upserting twice keeps one mapping per bank category and subcategory", async () => {
    const { user } = await importedWithoutMappings();
    const a = await category(user.id, "A");
    const b = await category(user.id, "B");
    for (const categoryId of [a.id, b.id]) {
      await upsertBankMapping(db, user.id, { bankCategory: "X", bankSubcategory: null, categoryId });
    }
    const listed = await listBankMappings(db, user.id);
    expect(listed).toHaveLength(1);
    expect(listed[0].categoryId).toBe(b.id);
  });

  it("scopes to the user: another user's category is refused and their rows are untouched", async () => {
    const owner = await importedWithoutMappings();
    const other = await setup();
    await runImport(other.user.id, other.account.id);
    const ownerCat = await category(owner.user.id, "Auto");

    const refused = await upsertBankMapping(db, other.user.id, {
      bankCategory: "Transports",
      bankSubcategory: null,
      categoryId: ownerCat.id,
    });
    expect(refused).toEqual({ ok: false, code: "category_not_found" });
    expect(await listBankMappings(db, other.user.id)).toEqual([]);

    await upsertBankMapping(db, owner.user.id, { bankCategory: "Transports", bankSubcategory: null, categoryId: ownerCat.id });
    await db.transaction((tx) => applyBankMappings(tx, owner.user.id));
    const untouched = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, other.user.id), isNotNull(transactions.categoryId)));
    expect(untouched).toEqual([]);
    expect(await listBankMappings(db, other.user.id)).toEqual([]);
  });

  it("looks up a mapping by id only for its owner", async () => {
    const { user } = await importedWithoutMappings();
    const other = await createTestUser();
    const auto = await category(user.id, "Auto");
    await upsertBankMapping(db, user.id, { bankCategory: "Transports", bankSubcategory: null, categoryId: auto.id });
    const [mapping] = await listBankMappings(db, user.id);
    expect(await getOwnedBankMapping(db, user.id, mapping.id)).toMatchObject({ bankCategory: "Transports" });
    expect(await getOwnedBankMapping(db, other.id, mapping.id)).toBeNull();
  });
});
