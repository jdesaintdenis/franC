// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { dedupeKey, prepareImport } from "../../lib/import";
import { db } from "../client";
import { categories, imports, transactions, transfers } from "../schema";
import { createTestUser, resetDb, seedCategories } from "../test-utils";
import { createAccount, listAccounts } from "./accounts";
import { createRule, applyRulesToUncategorized } from "./category-rules";
import { commitImport, loadExistingDedupeKeys, undoImport } from "./imports";
import { createMerchant } from "./merchants";
import { provisionUserDefaults } from "./provision";
import { countToReview, countToReviewForImport, countWaitingForCategory, listReviewQueue, markReviewed, markToReview } from "./review";
import { saveSplit } from "./splits";
import { bulkSetTransactionCategory, setTransactionCategory } from "./transactions";
import { confirmTransfer, linkTransfer, refreshTransfers, unlinkTransfer } from "./transfers";

const sampleText = readFileSync(join(process.cwd(), "docs/samples/sample-export.csv"), "utf-8");

let hashCounter = 0;

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  await seedCategories(user.id);
  const [main] = await listAccounts(user.id);
  const created = await createAccount(db, user.id, "Savings");
  if (!created.ok) throw new Error("createAccount failed");
  return { user, main, savings: created.account };
}

async function importSample(userId: string, accountId: string, filename = "export.csv") {
  const prepared = prepareImport(sampleText, accountId);
  if (!prepared.ok) throw new Error(prepared.fileError);
  const existing = await loadExistingDedupeKeys(
    db,
    userId,
    accountId,
    prepared.transactions.map((t) => t.dedupeHash),
  );
  const fresh = prepared.transactions.filter((t) => !existing.has(dedupeKey(t)));
  return commitImport(db, {
    userId,
    accountId,
    filename,
    rowsTotal: prepared.rowsTotal,
    rowsError: prepared.errors.length,
    transactions: fresh,
  });
}

interface Row {
  date: string;
  amountCents: number;
  label?: string;
  /** Default: still to review. */
  reviewed?: boolean;
  /** Gives the row the user's "Groceries" category: only rows with a destination can be validated. */
  categorized?: boolean;
}

async function seed(
  userId: string,
  accountId: string,
  rows: Row[],
  filename = "x.csv",
  uploadedAt?: Date,
): Promise<{ importId: string; ids: string[] }> {
  const groceries = rows.some((r) => r.categorized)
    ? (await db.select().from(categories).where(eq(categories.userId, userId))).find((c) => c.name === "Groceries")?.id ?? null
    : null;
  const [imp] = await db
    .insert(imports)
    .values({ userId, accountId, filename, rowsTotal: rows.length, rowsError: 0, ...(uploadedAt ? { uploadedAt } : {}) })
    .returning();
  const inserted = await db
    .insert(transactions)
    .values(
      rows.map((r) => ({
        userId,
        accountId,
        importId: imp.id,
        date: r.date,
        amountCents: r.amountCents,
        labelRaw: r.label ?? "L",
        labelNormalized: (r.label ?? "L").toLowerCase(),
        labelDisplay: r.label ?? "L",
        categoryId: r.categorized ? groceries : null,
        categorySource: r.categorized ? ("manual" as const) : null,
        reviewedAt: r.reviewed === false || r.reviewed === undefined ? null : new Date(),
        dedupeHash: `r${hashCounter++}`,
        occurrenceIndex: 0,
      })),
    )
    .returning({ id: transactions.id });
  return { importId: imp.id, ids: inserted.map((r) => r.id) };
}

async function reviewedState(ids: string[]): Promise<Map<string, boolean>> {
  const rows = await db
    .select({ id: transactions.id, reviewedAt: transactions.reviewedAt })
    .from(transactions)
    .where(inArray(transactions.id, ids));
  return new Map(rows.map((r) => [r.id, r.reviewedAt !== null]));
}

async function categoryId(userId: string, name: string): Promise<string> {
  const all = await db.select().from(categories).where(eq(categories.userId, userId));
  const found = all.find((c) => c.name === name);
  if (!found) throw new Error(`category ${name} not seeded`);
  return found.id;
}

describe("import and the review queue", () => {
  beforeEach(resetDb);

  it("puts imported rows in the queue while existing rows stay reviewed", async () => {
    const { user, main } = await setup();
    const old = await seed(user.id, main.id, [{ date: "2025-01-01", amountCents: -100, reviewed: true }]);
    const record = await importSample(user.id, main.id);
    expect(record.import.rowsInserted).toBeGreaterThan(0);

    expect(await countToReview(db, user.id)).toBe(record.import.rowsInserted);
    expect((await reviewedState(old.ids)).get(old.ids[0])).toBe(true);
  });

  it("keeps re-imported rows out of the queue and reviewed rows reviewed", async () => {
    const { user, main } = await setup();
    const first = await importSample(user.id, main.id);
    await db.update(transactions).set({ reviewedAt: new Date() }).where(eq(transactions.userId, user.id));

    const second = await importSample(user.id, main.id, "again.csv");
    expect(second.import.rowsInserted).toBe(0);
    expect(await countToReview(db, user.id)).toBe(0);
    expect(first.import.rowsInserted).toBeGreaterThan(0);
  });

  it("removes an undone import's rows from the queue and the count", async () => {
    const { user, main } = await setup();
    const record = await importSample(user.id, main.id);
    expect(await countToReview(db, user.id)).toBeGreaterThan(0);

    await undoImport(db, user.id, record.import.id);
    expect(await countToReview(db, user.id)).toBe(0);
    expect((await listReviewQueue(db, user.id)).items).toEqual([]);
  });
});

describe("markReviewed and markToReview", () => {
  beforeEach(resetDb);

  it("marks the given ids and returns only the ones that changed", async () => {
    const { user, main } = await setup();
    const { ids } = await seed(user.id, main.id, [
      { date: "2026-03-01", amountCents: -100, categorized: true },
      { date: "2026-03-02", amountCents: -200, categorized: true },
      { date: "2026-03-03", amountCents: -300, reviewed: true },
    ]);
    const changed = await markReviewed(db, user.id, { ids });
    expect(changed.sort()).toEqual([ids[0], ids[1]].sort());
    expect(await countToReview(db, user.id)).toBe(0);
  });

  it("marks one import's rows only", async () => {
    const { user, main } = await setup();
    const a = await seed(user.id, main.id, [{ date: "2026-03-01", amountCents: -100, categorized: true }], "a.csv");
    const b = await seed(user.id, main.id, [{ date: "2026-03-02", amountCents: -200, categorized: true }], "b.csv");
    const changed = await markReviewed(db, user.id, { importId: a.importId });
    expect(changed).toEqual(a.ids);
    expect((await reviewedState(b.ids)).get(b.ids[0])).toBe(false);
  });

  it("only marks rows that say where their money went", async () => {
    const { user, main } = await setup();
    const a = await seed(user.id, main.id, [
      { date: "2026-03-01", amountCents: -100, categorized: true },
      { date: "2026-03-02", amountCents: -200 },
    ], "a.csv");
    const b = await seed(user.id, main.id, [{ date: "2026-03-03", amountCents: -300, categorized: true }], "b.csv");

    expect(await countWaitingForCategory(db, user.id)).toBe(1);
    const changed = await markReviewed(db, user.id, { importId: a.importId });
    expect(changed).toEqual([a.ids[0]]);
    expect((await reviewedState(b.ids)).get(b.ids[0])).toBe(false);
    expect(await countToReviewForImport(db, user.id, a.importId)).toBe(1);
    expect(await countWaitingForCategory(db, user.id, { importId: a.importId })).toBe(1);
    expect(await markReviewed(db, user.id, { ids: [a.ids[1]] })).toEqual([]);

    // Another user's import matches nothing.
    const other = await setup();
    expect(await markReviewed(db, other.user.id, { importId: b.importId })).toEqual([]);
    expect(await countToReviewForImport(db, other.user.id, b.importId)).toBe(0);
  });

  it("accepts a split row and an ignored row, not a bare one", async () => {
    const { user, main } = await setup();
    const groceries = await categoryId(user.id, "Groceries");
    const { ids } = await seed(user.id, main.id, [
      { date: "2026-03-01", amountCents: -1000 },
      { date: "2026-03-02", amountCents: -500 },
      { date: "2026-03-03", amountCents: -700 },
    ]);
    await saveSplit(db, user.id, ids[0], [
      { categoryId: groceries, amountCents: -600 },
      { categoryId: groceries, amountCents: -400 },
    ]);
    await db.update(transactions).set({ ignoredAt: new Date() }).where(eq(transactions.id, ids[1]));
    // Saving a split already validates its row; the ignored row is the one left to mark.
    expect(await markReviewed(db, user.id, { ids })).toEqual([ids[1]]);
    expect(await countWaitingForCategory(db, user.id)).toBe(1);
  });

  it("marks everything", async () => {
    const { user, main, savings } = await setup();
    await seed(user.id, main.id, [{ date: "2026-03-01", amountCents: -100, categorized: true }]);
    await seed(user.id, savings.id, [{ date: "2026-03-02", amountCents: -200, categorized: true }]);
    expect(await markReviewed(db, user.id, { all: true })).toHaveLength(2);
    expect(await countToReview(db, user.id)).toBe(0);
    expect(await markReviewed(db, user.id, { all: true })).toEqual([]);
  });

  it("changes nothing for another user's ids, import or all", async () => {
    const mine = await setup();
    const theirs = await setup();
    const seeded = await seed(theirs.user.id, theirs.main.id, [{ date: "2026-03-01", amountCents: -100, categorized: true }]);

    expect(await markReviewed(db, mine.user.id, { ids: seeded.ids })).toEqual([]);
    expect(await markReviewed(db, mine.user.id, { importId: seeded.importId })).toEqual([]);
    expect(await markReviewed(db, mine.user.id, { all: true })).toEqual([]);
    expect(await countToReview(db, theirs.user.id)).toBe(1);

    // Undo is scoped too.
    await markReviewed(db, theirs.user.id, { all: true });
    expect(await markToReview(db, mine.user.id, seeded.ids)).toBe(0);
    expect(await countToReview(db, theirs.user.id)).toBe(0);
  });

  it("puts rows back in the queue with markToReview", async () => {
    const { user, main } = await setup();
    const { ids } = await seed(user.id, main.id, [
      { date: "2026-03-01", amountCents: -100, categorized: true },
      { date: "2026-03-02", amountCents: -200, categorized: true },
    ]);
    const changed = await markReviewed(db, user.id, { all: true });
    expect(await markToReview(db, user.id, changed)).toBe(2);
    expect(await countToReview(db, user.id)).toBe(2);
    expect(await markToReview(db, user.id, [])).toBe(0);
    expect((await reviewedState(ids)).get(ids[0])).toBe(false);
  });
});

describe("what marks a row reviewed", () => {
  beforeEach(resetDb);

  it("a manual category change does, even to the same category", async () => {
    const { user, main } = await setup();
    const groceries = await categoryId(user.id, "Groceries");
    const { ids } = await seed(user.id, main.id, [{ date: "2026-03-01", amountCents: -100 }]);
    await setTransactionCategory(db, user.id, ids[0], groceries);
    expect((await reviewedState(ids)).get(ids[0])).toBe(true);

    await markToReview(db, user.id, ids);
    await setTransactionCategory(db, user.id, ids[0], groceries);
    expect((await reviewedState(ids)).get(ids[0])).toBe(true);
  });

  it("a rejected category change does not", async () => {
    const { user, main } = await setup();
    const other = await setup();
    const foreign = await categoryId(other.user.id, "Groceries");
    const { ids } = await seed(user.id, main.id, [{ date: "2026-03-01", amountCents: -100 }]);
    expect(await setTransactionCategory(db, user.id, ids[0], foreign)).toBeNull();
    expect((await reviewedState(ids)).get(ids[0])).toBe(false);
  });

  it("a bulk edit does for the rows it changes, not for split rows it skips", async () => {
    const { user, main } = await setup();
    const groceries = await categoryId(user.id, "Groceries");
    const { ids } = await seed(user.id, main.id, [
      { date: "2026-03-01", amountCents: -1000 },
      { date: "2026-03-02", amountCents: -1000 },
    ]);
    const split = await saveSplit(db, user.id, ids[1], [
      { categoryId: groceries, amountCents: -400 },
      { categoryId: groceries, amountCents: -600 },
    ]);
    expect(split.ok).toBe(true);
    await markToReview(db, user.id, [ids[1]]);

    const result = await bulkSetTransactionCategory(db, user.id, ids, groceries);
    expect(result).toMatchObject({ updated: 1, skipped: 1 });
    const state = await reviewedState(ids);
    expect(state.get(ids[0])).toBe(true);
    expect(state.get(ids[1])).toBe(false);
  });

  it("saving a split does", async () => {
    const { user, main } = await setup();
    const groceries = await categoryId(user.id, "Groceries");
    const { ids } = await seed(user.id, main.id, [{ date: "2026-03-01", amountCents: -1000 }]);
    const result = await saveSplit(db, user.id, ids[0], [
      { categoryId: groceries, amountCents: -400 },
      { categoryId: groceries, amountCents: -600 },
    ]);
    expect(result.ok).toBe(true);
    expect((await reviewedState(ids)).get(ids[0])).toBe(true);
  });

  it("linking a transfer marks both legs; a failed link marks none", async () => {
    const { user, main, savings } = await setup();
    const a = await seed(user.id, main.id, [
      { date: "2026-03-10", amountCents: -5000 },
      { date: "2026-03-10", amountCents: -700 },
    ]);
    const b = await seed(user.id, savings.id, [{ date: "2026-03-11", amountCents: 5000 }]);

    const bad = await linkTransfer(db, user.id, a.ids[1], b.ids[0]);
    expect(bad.ok).toBe(false);
    expect((await reviewedState([...a.ids, ...b.ids])).get(b.ids[0])).toBe(false);

    const good = await linkTransfer(db, user.id, a.ids[0], b.ids[0]);
    expect(good.ok).toBe(true);
    const state = await reviewedState([...a.ids, ...b.ids]);
    expect(state.get(a.ids[0])).toBe(true);
    expect(state.get(b.ids[0])).toBe(true);
    expect(state.get(a.ids[1])).toBe(false);
  });

  it("confirming a detected transfer marks both legs; unlinking marks nothing", async () => {
    const { user, main, savings } = await setup();
    const a = await seed(user.id, main.id, [{ date: "2026-03-10", amountCents: -5000 }]);
    const b = await seed(user.id, savings.id, [{ date: "2026-03-12", amountCents: 5000 }]);
    expect(await refreshTransfers(db, user.id)).toBe(1);
    expect(await countToReview(db, user.id)).toBe(2);

    const [pair] = await db.select().from(transfers).where(eq(transfers.userId, user.id));
    const confirmed = await confirmTransfer(db, user.id, pair.id);
    expect(confirmed?.status).toBe("confirmed");
    expect(await countToReview(db, user.id)).toBe(0);

    await markToReview(db, user.id, [...a.ids, ...b.ids]);
    await unlinkTransfer(db, user.id, pair.id);
    expect(await countToReview(db, user.id)).toBe(2);
  });

  it("does not mark on a foreign transfer id", async () => {
    const mine = await setup();
    const theirs = await setup();
    await seed(theirs.user.id, theirs.main.id, [{ date: "2026-03-10", amountCents: -5000 }]);
    await seed(theirs.user.id, theirs.savings.id, [{ date: "2026-03-12", amountCents: 5000 }]);
    await refreshTransfers(db, theirs.user.id);
    const [pair] = await db.select().from(transfers).where(eq(transfers.userId, theirs.user.id));
    expect(await confirmTransfer(db, mine.user.id, pair.id)).toBeNull();
    expect(await countToReview(db, theirs.user.id)).toBe(2);
  });

  it("merchant recompute and applying rules to older rows do not", async () => {
    const { user, main } = await setup();
    const groceries = await categoryId(user.id, "Groceries");
    const { ids } = await seed(user.id, main.id, [{ date: "2026-03-01", amountCents: -100, label: "Carrefour city" }]);

    const merchant = await createMerchant(db, user.id, { name: "Carrefour", matchType: "contains", pattern: "carrefour" });
    expect(merchant.ok && merchant.rowsRenamed).toBe(1);
    await createRule(db, user.id, { categoryId: groceries, matchType: "contains", pattern: "carrefour" });
    const applied = await applyRulesToUncategorized(db, user.id);
    expect(applied.updated).toBe(1);

    expect((await reviewedState(ids)).get(ids[0])).toBe(false);
  });
});

describe("count and list", () => {
  beforeEach(resetDb);

  it("are scoped by user", async () => {
    const mine = await setup();
    const theirs = await setup();
    await seed(mine.user.id, mine.main.id, [{ date: "2026-03-01", amountCents: -100 }]);
    await seed(theirs.user.id, theirs.main.id, [
      { date: "2026-03-01", amountCents: -100 },
      { date: "2026-03-02", amountCents: -100 },
    ]);
    expect(await countToReview(db, mine.user.id)).toBe(1);
    const queue = await listReviewQueue(db, mine.user.id);
    expect(queue.total).toBe(1);
    expect(queue.items).toHaveLength(1);
  });

  it("orders by import upload (newest first), then date and id (newest first)", async () => {
    const { user, main, savings } = await setup();
    const older = await seed(
      user.id,
      main.id,
      [{ date: "2026-03-20", amountCents: -100 }],
      "older.csv",
      new Date("2026-04-01T10:00:00Z"),
    );
    const newer = await seed(
      user.id,
      savings.id,
      [
        { date: "2026-03-01", amountCents: -100 },
        { date: "2026-03-05", amountCents: -200 },
      ],
      "newer.csv",
      new Date("2026-04-02T10:00:00Z"),
    );
    await seed(user.id, main.id, [{ date: "2026-03-09", amountCents: -100, reviewed: true }], "done.csv");

    const queue = await listReviewQueue(db, user.id);
    expect(queue.total).toBe(3);
    expect(queue.items.map((i) => i.date)).toEqual(["2026-03-05", "2026-03-01", "2026-03-20"]);
    expect(queue.items[0].import).toEqual({
      id: newer.importId,
      filename: "newer.csv",
      kind: "csv",
      uploadedAt: "2026-04-02T10:00:00.000Z",
      accountName: "Savings",
    });
    expect(queue.items[2].import.id).toBe(older.importId);
    expect(queue.items[2].accountName).toBe(main.name);
  });

  it("caps the items at the limit but reports the full total", async () => {
    const { user, main } = await setup();
    await seed(user.id, main.id, [
      { date: "2026-03-01", amountCents: -100 },
      { date: "2026-03-02", amountCents: -100 },
      { date: "2026-03-03", amountCents: -100 },
    ]);
    const queue = await listReviewQueue(db, user.id, 2);
    expect(queue.items.map((i) => i.date)).toEqual(["2026-03-03", "2026-03-02"]);
    expect(queue.total).toBe(3);
  });

  it("carries split parts and transfer info like the Transactions list", async () => {
    const { user, main, savings } = await setup();
    const groceries = await categoryId(user.id, "Groceries");
    const a = await seed(user.id, main.id, [
      { date: "2026-03-10", amountCents: -5000 },
      { date: "2026-03-11", amountCents: -1000 },
    ]);
    await seed(user.id, savings.id, [{ date: "2026-03-12", amountCents: 5000 }]);
    await refreshTransfers(db, user.id);
    await saveSplit(db, user.id, a.ids[1], [
      { categoryId: groceries, amountCents: -400 },
      { categoryId: groceries, amountCents: -600 },
    ]);
    await markToReview(db, user.id, [a.ids[1]]);

    const { items } = await listReviewQueue(db, user.id);
    const transferItem = items.find((i) => i.id === a.ids[0]);
    expect(transferItem?.transfer).toMatchObject({ status: "detected", counterpartAccountName: "Savings" });
    expect(items.find((i) => i.id === a.ids[1])?.split?.parts).toHaveLength(2);
  });

  it("returns an empty queue", async () => {
    const { user } = await setup();
    expect(await listReviewQueue(db, user.id)).toEqual({ items: [], total: 0 });
  });
});
