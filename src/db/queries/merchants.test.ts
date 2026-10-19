// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { TRANSACTION_COLUMNS, transactionLines } from "../../lib/export/transactions";
import { dedupeKey } from "../../lib/import";
import { prepareImportGuessed } from "../../lib/import/prepare-guessed";
import { normalizeLabel } from "../../lib/import/normalize-label";
import { parseTransactionFilters } from "../../lib/transactions/filters";
import { db } from "../client";
import { imports, merchants, recurring, transactions } from "../schema";
import { createTestUser, resetDb, seedCategories } from "../test-utils";
import { listAccounts } from "./accounts";
import { createCategory } from "./categories";
import { createRule } from "./category-rules";
import { exportTransactions } from "./export";
import { commitImport, loadExistingDedupeKeys } from "./imports";
import {
  addMerchantPattern,
  countPatternMatches,
  createMerchant,
  deleteMerchant,
  listMerchants,
  recomputeMerchants,
  removeMerchantPattern,
  renameMerchant,
  restoreMerchant,
} from "./merchants";
import { provisionUserDefaults } from "./provision";
import { listRecurring, refreshRecurring, setRecurringStatus } from "./recurring";
import { listTransactions } from "./transactions";

const sampleText = readFileSync(join(process.cwd(), "docs/samples/sample-export.csv"), "utf-8");

let hashCounter = 0;

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

interface Row {
  date?: string;
  amountCents?: number;
  raw: string;
  simplified?: string;
}

async function seed(ctx: Ctx, rows: Row[]): Promise<string[]> {
  const inserted = await db
    .insert(transactions)
    .values(
      rows.map((r) => ({
        userId: ctx.user.id,
        accountId: ctx.account.id,
        importId: ctx.importId,
        date: r.date ?? "2025-09-29",
        amountCents: r.amountCents ?? -1000,
        labelRaw: r.raw,
        labelNormalized: normalizeLabel(r.raw),
        labelDisplay: r.simplified ?? r.raw,
        dedupeHash: `m${hashCounter++}`,
        occurrenceIndex: 0,
      })),
    )
    .returning({ id: transactions.id });
  return inserted.map((r) => r.id);
}

async function merchantOf(id: string): Promise<string | null> {
  const [row] = await db.select({ m: transactions.merchantId }).from(transactions).where(eq(transactions.id, id));
  return row.m;
}

async function create(userId: string, name: string, matchType: "contains" | "starts_with" | "equals", pattern: string) {
  const result = await createMerchant(db, userId, { name, matchType, pattern });
  if (!result.ok) throw new Error(result.error);
  return result;
}

const ORANGE: Row = { raw: "PRLV ORANGE BOX", simplified: "ORANGE" };
const TOLL: Row = { raw: "CB ASF ORANGERAIE FACT 110925", simplified: "ASF ORANGERAIE" };

describe("merchant queries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("names matching rows on create and lists patterns with counts", async () => {
    const ctx = await setup();
    const [orange, toll] = await seed(ctx, [ORANGE, TOLL]);
    const created = await create(ctx.user.id, "Orange", "equals", "orange");
    expect(created.created).toBe(true);
    expect(created.rowsRenamed).toBe(1);
    expect(await merchantOf(orange)).toBe(created.merchant.id);
    expect(await merchantOf(toll)).toBeNull();

    const [listed] = await listMerchants(db, ctx.user.id);
    expect(listed).toMatchObject({ name: "Orange", transactionCount: 1 });
    expect(listed.patterns.map((p) => [p.matchType, p.pattern])).toEqual([["equals", "orange"]]);
  });

  it("adds a pattern to an existing merchant found by name, ignoring case", async () => {
    const ctx = await setup();
    const [inter1, inter2] = await seed(ctx, [
      { raw: "CB INTERMARCHE FACT 110925", simplified: "INTERMARCHE" },
      { raw: "CB INTERMAR CENTRE FACT 110925", simplified: "INTERMAR CENTRE" },
    ]);
    const first = await create(ctx.user.id, "Intermarché", "contains", "INTERMARCHE");
    const second = await create(ctx.user.id, "intermarché", "contains", "INTERMAR CENTRE");
    expect(second.created).toBe(false);
    expect(second.merchant.id).toBe(first.merchant.id);
    expect(await merchantOf(inter1)).toBe(first.merchant.id);
    expect(await merchantOf(inter2)).toBe(first.merchant.id);
    expect(await db.select().from(merchants).where(eq(merchants.userId, ctx.user.id))).toHaveLength(1);

    const again = await createMerchant(db, ctx.user.id, { name: "INTERMARCHÉ".toLowerCase(), matchType: "contains", pattern: " intermar centre " });
    expect(again).toEqual({ ok: false, error: "pattern_exists" });
  });

  it("recompute writes only changed rows and is idempotent", async () => {
    const ctx = await setup();
    await seed(ctx, [ORANGE, TOLL, { raw: "CB NETFLIX.COM FACT 050925" }]);
    await create(ctx.user.id, "Orange", "contains", "orange");
    expect(await recomputeMerchants(db, ctx.user.id)).toBe(0);
  });

  it("recompute reports exactly the rows a new pattern changes", async () => {
    const ctx = await setup();
    const ids = await seed(ctx, [ORANGE, ORANGE, TOLL, { raw: "CB NETFLIX.COM FACT 050925" }]);
    const orange = await create(ctx.user.id, "Orange", "equals", "orange");
    expect(orange.rowsRenamed).toBe(2);
    const added = await addMerchantPattern(db, ctx.user.id, orange.merchant.id, { matchType: "contains", pattern: "asf orangeraie" });
    expect(added.ok && added.rowsRenamed).toBe(1);
    expect(await merchantOf(ids[2])).toBe(orange.merchant.id);
  });

  it("never applies another user's patterns or touches their rows", async () => {
    const mine = await setup();
    const theirs = await setup();
    const [mineRow] = await seed(mine, [ORANGE]);
    const [theirRow] = await seed(theirs, [ORANGE]);
    await create(theirs.user.id, "Theirs", "contains", "orange");
    expect(await merchantOf(theirRow)).not.toBeNull();
    expect(await merchantOf(mineRow)).toBeNull();

    const mineCreated = await create(mine.user.id, "Mine", "contains", "orange");
    expect(await merchantOf(theirRow)).not.toBe(mineCreated.merchant.id);
    expect(await merchantOf(mineRow)).toBe(mineCreated.merchant.id);
  });

  it("rename keeps the rows; removing a pattern and deleting free them", async () => {
    const ctx = await setup();
    const [row] = await seed(ctx, [ORANGE]);
    const { merchant, } = await create(ctx.user.id, "Orange", "equals", "orange");

    const renamed = await renameMerchant(db, ctx.user.id, merchant.id, "Orange Mobile");
    expect(renamed.ok && renamed.rowsRenamed).toBe(0);
    expect(await merchantOf(row)).toBe(merchant.id);
    const [{ items: [item] }] = [await listTransactions(db, ctx.user.id, parseTransactionFilters({}), null)];
    expect(item).toMatchObject({ label: "Orange Mobile", bankLabel: "PRLV ORANGE BOX", merchant: { id: merchant.id, name: "Orange Mobile" } });

    const [listed] = await listMerchants(db, ctx.user.id);
    const removed = await removeMerchantPattern(db, ctx.user.id, listed.patterns[0].id);
    expect(removed.ok && removed.rowsRenamed).toBe(1);
    expect(await merchantOf(row)).toBeNull();

    await addMerchantPattern(db, ctx.user.id, merchant.id, { matchType: "equals", pattern: "orange" });
    expect(await merchantOf(row)).toBe(merchant.id);
    const deleted = await deleteMerchant(db, ctx.user.id, merchant.id);
    expect(deleted.ok).toBe(true);
    expect(await merchantOf(row)).toBeNull();
    expect(await listMerchants(db, ctx.user.id)).toEqual([]);
  });

  it("restores a deleted merchant with the same ids and re-names its rows", async () => {
    const ctx = await setup();
    const [row] = await seed(ctx, [ORANGE]);
    const { merchant } = await create(ctx.user.id, "Orange", "equals", "orange");
    await addMerchantPattern(db, ctx.user.id, merchant.id, { matchType: "contains", pattern: "orange box" });
    const [before] = await listMerchants(db, ctx.user.id);

    const deleted = await deleteMerchant(db, ctx.user.id, merchant.id);
    if (!deleted.ok) throw new Error(deleted.error);
    expect(deleted.snapshot.patterns).toHaveLength(2);
    expect(await merchantOf(row)).toBeNull();

    const restored = await restoreMerchant(db, ctx.user.id, deleted.snapshot);
    expect(restored.ok && restored.rowsRenamed).toBe(1);
    expect(await merchantOf(row)).toBe(merchant.id);
    const [after] = await listMerchants(db, ctx.user.id);
    expect(after.id).toBe(before.id);
    expect(after.patterns.map((p) => [p.id, p.matchType, p.pattern])).toEqual(
      before.patterns.map((p) => [p.id, p.matchType, p.pattern]),
    );
  });

  it("refuses to restore when the name is taken, twice, or onto another user's id", async () => {
    const mine = await setup();
    const other = await setup();
    const { merchant } = await create(mine.user.id, "Orange", "equals", "orange");
    const deleted = await deleteMerchant(db, mine.user.id, merchant.id);
    if (!deleted.ok) throw new Error(deleted.error);

    await create(mine.user.id, "ORANGE", "contains", "x");
    expect(await restoreMerchant(db, mine.user.id, deleted.snapshot)).toEqual({ ok: false, error: "name_taken" });
    await db.delete(merchants).where(eq(merchants.userId, mine.user.id));

    expect(await restoreMerchant(db, mine.user.id, deleted.snapshot)).toMatchObject({ ok: true });
    // Restoring twice finds the name; a snapshot with a taken id and a new name finds the id.
    expect(await restoreMerchant(db, mine.user.id, deleted.snapshot)).toEqual({ ok: false, error: "name_taken" });
    expect(await restoreMerchant(db, other.user.id, deleted.snapshot)).toEqual({ ok: false, error: "not_found" });
    expect(await listMerchants(db, other.user.id)).toEqual([]);
  });

  it("hands rows to another merchant's pattern when their merchant is deleted", async () => {
    const ctx = await setup();
    const [row] = await seed(ctx, [ORANGE]);
    const specific = await create(ctx.user.id, "Orange", "equals", "orange");
    const broad = await create(ctx.user.id, "Telecom", "contains", "orange");
    expect(await merchantOf(row)).toBe(specific.merchant.id);
    await deleteMerchant(db, ctx.user.id, specific.merchant.id);
    expect(await merchantOf(row)).toBe(broad.merchant.id);
  });

  it("checks ownership and name clashes", async () => {
    const mine = await setup();
    const other = await setup();
    const theirs = await create(other.user.id, "Theirs", "contains", "x");
    const [theirPattern] = (await listMerchants(db, other.user.id))[0].patterns;

    expect(await renameMerchant(db, mine.user.id, theirs.merchant.id, "Hijack")).toEqual({ ok: false, error: "not_found" });
    expect(await addMerchantPattern(db, mine.user.id, theirs.merchant.id, { matchType: "contains", pattern: "y" })).toEqual({ ok: false, error: "not_found" });
    expect(await removeMerchantPattern(db, mine.user.id, theirPattern.id)).toEqual({ ok: false, error: "not_found" });
    expect(await deleteMerchant(db, mine.user.id, theirs.merchant.id)).toEqual({ ok: false, error: "not_found" });
    expect(await listMerchants(db, other.user.id)).toHaveLength(1);

    const a = await create(mine.user.id, "Orange", "contains", "orange");
    await create(mine.user.id, "Free", "contains", "free");
    expect(await renameMerchant(db, mine.user.id, a.merchant.id, "FREE")).toEqual({ ok: false, error: "name_taken" });
    expect((await renameMerchant(db, mine.user.id, a.merchant.id, "ORANGE")).ok).toBe(true);
  });

  it("counts the rows a pattern would name, scoped to the user", async () => {
    const mine = await setup();
    const other = await setup();
    await seed(mine, [ORANGE, ORANGE, TOLL]);
    await seed(other, [ORANGE]);
    expect(await countPatternMatches(db, mine.user.id, "equals", "orange")).toBe(2);
    expect(await countPatternMatches(db, mine.user.id, "contains", "orange")).toBe(3);
    expect(await countPatternMatches(db, mine.user.id, "starts_with", "cb asf")).toBe(1);
    expect(await countPatternMatches(db, mine.user.id, "contains", "   ")).toBe(0);
  });

  it("re-applies rules to uncategorized rows using the merchant name, never touching manual ones", async () => {
    const ctx = await setup();
    const [free, manual] = await seed(ctx, [ORANGE, ORANGE]);
    const telecom = await createCategory(db, ctx.user.id, { name: "Telecom", color: "#112233" });
    const other = await createCategory(db, ctx.user.id, { name: "Other kind", color: "#112233" });
    if (!telecom.ok || !other.ok) throw new Error("category");
    await createRule(db, ctx.user.id, { categoryId: telecom.category.id, matchType: "contains", pattern: "mobile plan" });
    await db
      .update(transactions)
      .set({ categoryId: other.category.id, categorySource: "manual" })
      .where(eq(transactions.id, manual));

    const created = await create(ctx.user.id, "Mobile Plan", "equals", "orange");
    expect(created.rowsCategorized).toBe(1);
    const rows = await db.select().from(transactions).where(eq(transactions.userId, ctx.user.id));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(free)).toMatchObject({ categoryId: telecom.category.id, categorySource: "rule" });
    expect(byId.get(manual)).toMatchObject({ categoryId: other.category.id, categorySource: "manual" });
  });
});

describe("import and search with merchants", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function importSample(userId: string, accountId: string) {
    const prepared = prepareImportGuessed(sampleText, accountId);
    if (!prepared.ok) throw new Error(prepared.fileError);
    const existing = await loadExistingDedupeKeys(db, userId, accountId, prepared.transactions.map((t) => t.dedupeHash));
    return commitImport(db, {
      userId,
      accountId,
      filename: "export.csv",
      rowsTotal: prepared.rowsTotal,
      rowsError: prepared.errors.length,
      transactions: prepared.transactions.filter((t) => !existing.has(dedupeKey(t))),
    });
  }

  it("names new rows at import, before rules, without touching the labels", async () => {
    const ctx = await setup();
    const telecom = await createCategory(db, ctx.user.id, { name: "Telecom", color: "#112233" });
    if (!telecom.ok) throw new Error("category");
    await createRule(db, ctx.user.id, { categoryId: telecom.category.id, matchType: "equals", pattern: "Orange Mobile" });
    const created = await create(ctx.user.id, "Orange Mobile", "equals", "horizon telecom");

    await importSample(ctx.user.id, ctx.account.id);

    const rows = await db.select().from(transactions).where(eq(transactions.userId, ctx.user.id));
    const named = rows.filter((r) => r.merchantId === created.merchant.id);
    expect(named.length).toBeGreaterThan(0);
    for (const r of named) {
      expect(r.labelDisplay).toBe("HORIZON TELECOM");
      expect(r.labelRaw).toBe("PRLV HORIZON TELECOM");
      // The rule only matches the merchant name, so the row was named before rules ran.
      expect(r).toMatchObject({ categoryId: telecom.category.id, categorySource: "rule" });
    }
    expect(rows.some((r) => r.merchantId === null)).toBe(true);
  });

  it("searches the merchant name and the bank labels, and filters by merchant", async () => {
    const ctx = await setup();
    const [orange, toll] = await seed(ctx, [ORANGE, TOLL]);
    const { merchant } = await create(ctx.user.id, "Téléphone Mobile", "equals", "orange");
    const other = await setup();
    await seed(other, [ORANGE]);
    const list = async (sp: Record<string, string>) =>
      (await listTransactions(db, ctx.user.id, parseTransactionFilters(sp), null)).items.map((i) => i.id);

    expect(await list({ q: "telephone mobile" })).toEqual([orange]);
    expect(await list({ q: "PRLV ORANGE" })).toEqual([orange]);
    expect((await list({ q: "orange" })).sort()).toEqual([orange, toll].sort());
    expect(await list({ merchant: merchant.id })).toEqual([orange]);
    // Another user's merchant id matches nothing of mine.
    const foreign = await create(other.user.id, "Foreign", "contains", "orange");
    expect(await list({ merchant: foreign.merchant.id })).toEqual([]);
    expect(parseTransactionFilters({ merchant: "nope" }).merchant).toBeUndefined();
  });

  it("puts the merchant name in the export label column and keeps the bank label", async () => {
    const ctx = await setup();
    await seed(ctx, [ORANGE, TOLL]);
    await create(ctx.user.id, "Orange Mobile", "equals", "orange");
    const rows = await exportTransactions(db, ctx.user.id, parseTransactionFilters({}));
    const lines = transactionLines(rows, ".", { categorySource: (c) => c });
    const labels = lines.map((l) => [l[2].value, l[TRANSACTION_COLUMNS.indexOf("bankLabel")].value]);
    expect(labels).toContainEqual(["Orange Mobile", "PRLV ORANGE BOX"]);
    expect(labels).toContainEqual(["ASF ORANGERAIE", "CB ASF ORANGERAIE FACT 110925"]);
  });
});

describe("recurring with merchants", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const monthly = (label: string, dates: string[]): Row[] => dates.map((date) => ({ date, amountCents: -4210, raw: label }));

  it("groups two label variants under the merchant and keeps a confirmed item through the merge", async () => {
    const ctx = await setup();
    await seed(ctx, monthly("CB INTERMARCHE FACT 110625", ["2025-06-11", "2025-07-11", "2025-08-11"]));
    await refreshRecurring(db, ctx.user.id);
    const [first] = await listRecurring(db, ctx.user.id);
    await setRecurringStatus(db, ctx.user.id, first.id, "confirmed");

    await seed(ctx, monthly("CB INTERMAR CENTRE FACT 110925", ["2025-09-11", "2025-10-11", "2025-11-11"]));
    await refreshRecurring(db, ctx.user.id);
    expect(await listRecurring(db, ctx.user.id)).toHaveLength(2);

    const { merchant } = await create(ctx.user.id, "Intermarché", "contains", "INTERMARCHE");
    await addMerchantPattern(db, ctx.user.id, merchant.id, { matchType: "contains", pattern: "INTERMAR CENTRE" });
    await refreshRecurring(db, ctx.user.id);

    const items = await listRecurring(db, ctx.user.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: first.id,
      status: "confirmed",
      name: "Intermarché",
      merchantId: merchant.id,
      merchantKey: `merchant:${merchant.id}`,
      lastSeenDate: "2025-11-11",
    });
    const linked = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.recurringId, first.id));
    expect(linked).toHaveLength(6);
  });

  it("follows the transactions back when the merchant is deleted, and leaves dismissed items alone", async () => {
    const ctx = await setup();
    await seed(ctx, monthly("PRLV ORANGE SA", ["2025-07-05", "2025-08-05", "2025-09-05"]));
    await seed(ctx, monthly("CB NETFLIX.COM FACT 050925", ["2025-07-06", "2025-08-06", "2025-09-06"]));
    const { merchant } = await create(ctx.user.id, "Orange", "contains", "orange");
    await refreshRecurring(db, ctx.user.id);
    const items = await listRecurring(db, ctx.user.id);
    const named = items.find((i) => i.merchantId === merchant.id);
    const netflix = items.find((i) => i.merchantId === null);
    if (!named || !netflix) throw new Error("items");
    await setRecurringStatus(db, ctx.user.id, named.id, "confirmed");
    await setRecurringStatus(db, ctx.user.id, netflix.id, "dismissed");

    await deleteMerchant(db, ctx.user.id, merchant.id);
    await refreshRecurring(db, ctx.user.id);

    const rows = await db.select().from(recurring).where(eq(recurring.userId, ctx.user.id));
    expect(rows.find((r) => r.id === named.id)).toMatchObject({ status: "confirmed", merchantKey: "ORANGE SA" });
    expect(rows.find((r) => r.id === netflix.id)).toMatchObject({ status: "dismissed", merchantKey: netflix.merchantKey });
  });
});
