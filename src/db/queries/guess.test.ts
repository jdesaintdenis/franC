// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { KeyedTransaction } from "../../lib/import/types";
import { db } from "../client";
import { categories, imports, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { createAccount, listAccounts } from "./accounts";
import { applyBankMappings, upsertBankMapping } from "./bank-categories";
import { applyRulesToUncategorized, createRule, loadCompiledRules } from "./category-rules";
import {
  acceptGuess,
  dismissRuleSuggestion,
  guessCategories,
  listRuleSuggestions,
  loadGuessExamples,
  suggestionForTransaction,
} from "./guess";
import { commitImport } from "./imports";
import { createMerchant } from "./merchants";
import { provisionUserDefaults } from "./provision";
import { countToReview } from "./review";
import { saveSplit } from "./splits";
import { setTransactionCategory } from "./transactions";
import { linkTransfer } from "./transfers";

let counter = 0;

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [main] = await listAccounts(user.id);
  const [food, resto, shop] = await db
    .insert(categories)
    .values(["Food", "Restaurants", "Shopping"].map((name) => ({ userId: user.id, name, color: "#123456" })))
    .returning();
  const [imp] = await db
    .insert(imports)
    .values({ userId: user.id, accountId: main.id, filename: "x.csv", rowsTotal: 0, rowsError: 0 })
    .returning();
  return { user, main, imp, food, resto, shop };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

async function addRow(
  c: Ctx,
  label: string,
  over: Partial<typeof transactions.$inferInsert> = {},
): Promise<string> {
  counter += 1;
  const [row] = await db
    .insert(transactions)
    .values({
      userId: c.user.id,
      accountId: c.main.id,
      importId: c.imp.id,
      date: "2025-09-10",
      amountCents: -450,
      labelRaw: label,
      labelNormalized: label,
      labelDisplay: label,
      dedupeHash: `h${counter}`,
      occurrenceIndex: 0,
      ...over,
    })
    .returning({ id: transactions.id });
  return row.id;
}

async function source(id: string) {
  const [r] = await db
    .select({ categoryId: transactions.categoryId, source: transactions.categorySource, reviewedAt: transactions.reviewedAt })
    .from(transactions)
    .where(eq(transactions.id, id));
  return r;
}

const BAKERY = (n: number) => `CB BOULANGERIE DES L FACT 2509${10 + n}`;

function keyed(label: string, n: number, amountCents = -450): KeyedTransaction {
  return {
    line: n + 2,
    date: "2025-09-25",
    amountCents,
    labelRaw: label,
    labelSimplified: label,
    labelNormalized: label,
    bankCategory: null,
    bankSubcategory: null,
    dedupeHash: `imp${n}-${label}`,
    occurrenceIndex: 0,
  };
}

beforeEach(resetDb);

describe("guessing on import", () => {
  it("guesses rows left uncategorized, after rules and bank, without touching older rows", async () => {
    const c = await setup();
    await addRow(c, BAKERY(0), { categoryId: c.food.id, categorySource: "manual" });
    const oldUncategorized = await addRow(c, BAKERY(1));
    await createRule(db, c.user.id, { categoryId: c.shop.id, matchType: "contains", pattern: "DECATHLON" });
    await addRow(c, "CB DECATHLON LILLE FACT 250901", { categoryId: c.shop.id, categorySource: "manual" });

    const result = await commitImport(db, {
      userId: c.user.id,
      accountId: c.main.id,
      filename: "new.csv",
      rowsTotal: 3,
      rowsError: 0,
      transactions: [
        keyed("CB BOULANGERIE DES L FACT 250925", 1),
        keyed("CB DECATHLON LILLE FACT 250925", 2),
        keyed("CB INCONNU XYZ FACT 250925", 3),
      ],
    });
    expect(result.rowsGuessed).toBe(1);

    const rows = await db.select().from(transactions).where(eq(transactions.importId, result.import.id));
    const by = new Map(rows.map((r) => [r.labelNormalized, r]));
    expect(by.get("CB BOULANGERIE DES L FACT 250925")).toMatchObject({ categoryId: c.food.id, categorySource: "guess" });
    expect(by.get("CB DECATHLON LILLE FACT 250925")).toMatchObject({ categoryId: c.shop.id, categorySource: "rule" });
    expect(by.get("CB INCONNU XYZ FACT 250925")?.categoryId).toBeNull();
    // An older uncategorized row is not part of this import.
    expect((await source(oldUncategorized)).categoryId).toBeNull();
  });

  it("does not guess a refund from purchases", async () => {
    const c = await setup();
    await addRow(c, BAKERY(0), { categoryId: c.food.id, categorySource: "manual" });
    const result = await commitImport(db, {
      userId: c.user.id,
      accountId: c.main.id,
      filename: "new.csv",
      rowsTotal: 1,
      rowsError: 0,
      transactions: [keyed("CB BOULANGERIE DES L FACT 250925", 1, 450)],
    });
    expect(result.rowsGuessed).toBe(0);
  });
});

describe("precedence", () => {
  it("rules and bank mappings replace guesses; nothing replaces manual", async () => {
    const c = await setup();
    const guessed = await addRow(c, "CB ORANGE FACT 250901", {
      categoryId: c.food.id,
      categorySource: "guess",
      bankCategory: "Telecom",
    });
    const guessed2 = await addRow(c, "CB SNCF FACT 250901", { categoryId: c.food.id, categorySource: "guess", bankCategory: "Transports" });
    const manual = await addRow(c, "CB ORANGE FACT 250902", { categoryId: c.food.id, categorySource: "manual", bankCategory: "Telecom" });

    await createRule(db, c.user.id, { categoryId: c.shop.id, matchType: "contains", pattern: "ORANGE" });
    await applyRulesToUncategorized(db, c.user.id);
    expect(await source(guessed)).toMatchObject({ categoryId: c.shop.id, source: "rule" });
    expect(await source(manual)).toMatchObject({ categoryId: c.food.id, source: "manual" });

    await upsertBankMapping(db, c.user.id, { bankCategory: "Transports", bankSubcategory: null, categoryId: c.resto.id });
    expect(await applyBankMappings(db, c.user.id)).toBe(1);
    expect(await source(guessed2)).toMatchObject({ categoryId: c.resto.id, source: "bank" });
  });
});

describe("acceptGuess", () => {
  it("turns a guess into a manual category and marks the row reviewed", async () => {
    const c = await setup();
    const id = await addRow(c, BAKERY(0), { categoryId: c.food.id, categorySource: "guess", reviewedAt: null });
    expect(await countToReview(db, c.user.id)).toBe(1);
    const accepted = await acceptGuess(db, c.user.id, id);
    expect(accepted?.category.id).toBe(c.food.id);
    const row = await source(id);
    expect(row).toMatchObject({ categoryId: c.food.id, source: "manual" });
    expect(row.reviewedAt).not.toBeNull();
    expect(await countToReview(db, c.user.id)).toBe(0);
  });

  it("only accepts guesses of the user", async () => {
    const c = await setup();
    const other = await setup();
    const manual = await addRow(c, BAKERY(0), { categoryId: c.food.id, categorySource: "manual" });
    const theirs = await addRow(other, BAKERY(0), { categoryId: other.food.id, categorySource: "guess" });
    expect(await acceptGuess(db, c.user.id, manual)).toBeNull();
    expect(await acceptGuess(db, c.user.id, theirs)).toBeNull();
    expect((await source(theirs)).source).toBe("guess");
  });
});

describe("guessCategories", () => {
  it("re-applies mappings, requeues guessed reviewed rows, skips split, transfer and other users' rows", async () => {
    const c = await setup();
    const other = await setup();
    await addRow(c, BAKERY(0), { categoryId: c.food.id, categorySource: "manual" });
    await addRow(other, BAKERY(0), { categoryId: other.food.id, categorySource: "manual" });

    const reviewed = await addRow(c, BAKERY(1), { reviewedAt: new Date() });
    const split = await addRow(c, BAKERY(2), { reviewedAt: new Date() });
    await saveSplit(db, c.user.id, split, [
      { categoryId: c.food.id, amountCents: -200 },
      { categoryId: c.resto.id, amountCents: -250 },
    ]);
    const mapped = await addRow(c, "CB SNCF FACT 250901", { bankCategory: "Transports" });
    const theirs = await addRow(other, BAKERY(1));

    const savings = await createAccount(db, c.user.id, "Savings");
    if (!savings.ok) throw new Error("account");
    const outRow = await addRow(c, BAKERY(3), { amountCents: -1000 });
    const inRow = await addRow(c, BAKERY(4), { amountCents: 1000, accountId: savings.account.id });
    expect((await linkTransfer(db, c.user.id, outRow, inRow)).ok).toBe(true);

    await upsertBankMapping(db, c.user.id, { bankCategory: "Transports", bankSubcategory: null, categoryId: c.resto.id });
    await db.update(transactions).set({ categoryId: null, categorySource: null }).where(eq(transactions.id, mapped));

    const counts = await guessCategories(db, c.user.id);
    expect(counts).toEqual({ rules: 0, bank: 1, guessed: 1 });
    expect(await source(mapped)).toMatchObject({ source: "bank", categoryId: c.resto.id });
    const r = await source(reviewed);
    expect(r).toMatchObject({ source: "guess", categoryId: c.food.id });
    expect(r.reviewedAt).toBeNull();
    expect((await source(split)).source).toBeNull();
    expect((await source(outRow)).categoryId).toBeNull();
    expect((await source(theirs)).categoryId).toBeNull();
  });

  it("learns from rule categories but not from guesses, split rows or transfers", async () => {
    const c = await setup();
    await addRow(c, "CB A FACT 250901", { categoryId: c.food.id, categorySource: "rule" });
    await addRow(c, "CB B FACT 250901", { categoryId: c.food.id, categorySource: "guess" });
    await addRow(c, "CB C FACT 250901", { categoryId: c.food.id, categorySource: "bank" });
    expect(await loadGuessExamples(db, c.user.id)).toHaveLength(1);
  });
});

describe("rule suggestions", () => {
  async function threeBakery(c: Ctx) {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await addRow(c, BAKERY(i));
      await setTransactionCategory(db, c.user.id, id, c.food.id);
      ids.push(id);
    }
    return ids;
  }

  it("suggests after 3 hand categorizations with the count it would categorize", async () => {
    const c = await setup();
    const ids = await threeBakery(c);
    await addRow(c, BAKERY(5));
    await addRow(c, BAKERY(6), { categoryId: c.shop.id, categorySource: "guess" });
    expect(await suggestionForTransaction(db, c.user.id, ids[1])).toMatchObject({
      matchType: "contains",
      pattern: "BOULANGERIE DES L",
      count: 3,
      wouldCategorize: 2,
      category: { id: c.food.id },
    });
    expect(await listRuleSuggestions(db, c.user.id)).toHaveLength(1);
  });

  it("does not suggest twice the rule already exists and does not suggest for guesses", async () => {
    const c = await setup();
    const ids = await threeBakery(c);
    await db.update(transactions).set({ categorySource: "guess" }).where(eq(transactions.id, ids[0]));
    expect(await listRuleSuggestions(db, c.user.id)).toEqual([]);
    await db.update(transactions).set({ categorySource: "manual" }).where(eq(transactions.id, ids[0]));
    await createRule(db, c.user.id, { categoryId: c.food.id, matchType: "contains", pattern: "BOULANGERIE" });
    expect((await loadCompiledRules(db, c.user.id)).length).toBe(1);
    expect(await listRuleSuggestions(db, c.user.id)).toEqual([]);
  });

  it("uses the merchant name for merchant groups", async () => {
    const c = await setup();
    const merchant = await createMerchant(db, c.user.id, { name: "Boulangerie Dupont", matchType: "contains", pattern: "BOULANGERIE" });
    if (!merchant.ok) throw new Error("merchant");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await addRow(c, BAKERY(i), { merchantId: merchant.merchant.id });
      await setTransactionCategory(db, c.user.id, id, c.food.id);
      ids.push(id);
    }
    expect(await suggestionForTransaction(db, c.user.id, ids[0])).toMatchObject({
      matchType: "equals",
      pattern: "Boulangerie Dupont",
      merchantId: merchant.merchant.id,
    });
  });

  it("is scoped by user and dismissals hide the suggestion", async () => {
    const c = await setup();
    const other = await setup();
    await threeBakery(c);
    expect(await listRuleSuggestions(db, other.user.id)).toEqual([]);

    const input = { matchType: "contains" as const, pattern: "BOULANGERIE DES L", categoryId: c.food.id };
    expect(await dismissRuleSuggestion(db, other.user.id, input)).toBe(false);
    expect(await listRuleSuggestions(db, c.user.id)).toHaveLength(1);
    expect(await dismissRuleSuggestion(db, c.user.id, input)).toBe(true);
    expect(await dismissRuleSuggestion(db, c.user.id, input)).toBe(true);
    expect(await listRuleSuggestions(db, c.user.id)).toEqual([]);
  });

  it("deleting a category removes its dismissals", async () => {
    const c = await setup();
    await dismissRuleSuggestion(db, c.user.id, { matchType: "contains", pattern: "BOULANGERIE DES L", categoryId: c.shop.id });
    await db.delete(categories).where(and(eq(categories.id, c.shop.id), eq(categories.userId, c.user.id)));
    const { ruleSuggestionDismissals } = await import("../schema");
    expect(await db.select().from(ruleSuggestionDismissals)).toEqual([]);
  });
});
