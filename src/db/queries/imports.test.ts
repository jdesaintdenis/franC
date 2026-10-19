// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { BankCategoryWrites } from "../../lib/categorize/bank";
import { dedupeKey } from "../../lib/import";
import { prepareImportGuessed } from "../../lib/import/prepare-guessed";
import { db } from "../client";
import { categories, imports, transactions } from "../schema";
import { createTestUser, resetDb, seedCategories } from "../test-utils";
import { getOwnedAccount, listAccounts } from "./accounts";
import { AccountNotOwnedError, commitImport, listImports, loadExistingDedupeKeys, undoImport } from "./imports";
import { createCategory } from "./categories";
import { createRule } from "./category-rules";
import { provisionUserDefaults } from "./provision";
import { setTransactionCategory } from "./transactions";

const sampleText = readFileSync(join(process.cwd(), "docs/samples/sample-export.csv"), "utf-8");
const [header, ...dataLines] = sampleText.split(/\r?\n/).filter((l) => l.length > 0);

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  await seedCategories(user.id);
  const [account] = await listAccounts(user.id);
  return { user, account };
}

function prepare(text: string, accountId: string) {
  const result = prepareImportGuessed(text, accountId);
  if (!result.ok) throw new Error(result.fileError);
  return result;
}

/** Mimics the server flow: load existing keys, keep the fresh rows, commit. */
async function importText(userId: string, accountId: string, text: string) {
  return (await importFull(userId, accountId, text)).import;
}

async function importFull(userId: string, accountId: string, text: string, bankWrites?: BankCategoryWrites) {
  const prepared = prepare(text, accountId);
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
    filename: "export.csv",
    rowsTotal: prepared.rowsTotal,
    rowsError: prepared.errors.length,
    transactions: fresh,
    bankWrites,
  });
}

async function countTransactions(userId: string) {
  return (await db.select().from(transactions).where(eq(transactions.userId, userId))).length;
}

describe("commitImport", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("inserts all valid rows of the sample and records the counts", async () => {
    const { user, account } = await setup();
    const prepared = prepare(sampleText, account.id);
    const record = await importText(user.id, account.id, sampleText);

    expect(record.rowsTotal).toBe(prepared.rowsTotal);
    expect(record.rowsInserted).toBe(prepared.transactions.length);
    expect(record.rowsDuplicate).toBe(0);
    expect(record.rowsError).toBe(prepared.errors.length);
    expect(await countTransactions(user.id)).toBe(prepared.transactions.length);

    const [row] = await db.select().from(transactions).where(eq(transactions.userId, user.id)).limit(1);
    expect(row.labelDisplay).toBeTruthy();
    expect(row.importId).toBe(record.id);
  });

  it("re-importing the same file inserts nothing but still records an import", async () => {
    const { user, account } = await setup();
    const prepared = prepare(sampleText, account.id);
    await importText(user.id, account.id, sampleText);
    const second = await importText(user.id, account.id, sampleText);

    expect(second.rowsInserted).toBe(0);
    expect(second.rowsTotal).toBe(prepared.rowsTotal);
    expect(await countTransactions(user.id)).toBe(prepared.transactions.length);
    const all = await db.select().from(imports).where(eq(imports.userId, user.id));
    expect(all).toHaveLength(2);
  });

  it("counts conflicts as duplicates when unfiltered rows are committed again", async () => {
    const { user, account } = await setup();
    const prepared = prepare(sampleText, account.id);
    const input = {
      userId: user.id,
      accountId: account.id,
      filename: "export.csv",
      rowsTotal: prepared.rowsTotal,
      rowsError: prepared.errors.length,
      transactions: prepared.transactions,
    };
    await commitImport(db, input);
    const { import: second } = await commitImport(db, input);
    expect(second.rowsInserted).toBe(0);
    expect(second.rowsDuplicate).toBe(prepared.transactions.length);
  });

  it("an overlapping export only inserts the rows missing from the first", async () => {
    const { user, account } = await setup();
    const first = [header, ...dataLines.slice(0, 60)].join("\r\n");
    const second = [header, ...dataLines.slice(39)].join("\r\n");
    const firstCount = prepare(first, account.id).transactions.length;
    const secondPrepared = prepare(second, account.id);
    const union = prepare(sampleText, account.id).transactions.length;

    await importText(user.id, account.id, first);
    const record = await importText(user.id, account.id, second);

    expect(record.rowsInserted).toBe(union - firstCount);
    expect(record.rowsTotal).toBe(secondPrepared.rowsTotal);
    expect(await countTransactions(user.id)).toBe(union);
  });

  it("keeps two identical same-day rows and stays idempotent on re-import", async () => {
    const { user, account } = await setup();
    const line = dataLines[0];
    const csv = [header, line, line].join("\r\n");

    const first = await importText(user.id, account.id, csv);
    expect(first.rowsInserted).toBe(2);
    const second = await importText(user.id, account.id, csv);
    expect(second.rowsInserted).toBe(0);
    expect(await countTransactions(user.id)).toBe(2);
  });

  it("leaves nothing behind when the commit fails midway", async () => {
    const { user, account } = await setup();
    const prepared = prepare(sampleText, account.id);
    const bad = { ...prepared.transactions[0], date: "not-a-date" };

    await expect(
      commitImport(db, {
        userId: user.id,
        accountId: account.id,
        filename: "bad.csv",
        rowsTotal: 1,
        rowsError: 0,
        transactions: [...prepared.transactions.slice(1, 5), bad],
      }),
    ).rejects.toThrow();

    expect(await countTransactions(user.id)).toBe(0);
    expect(await db.select().from(imports).where(eq(imports.userId, user.id))).toHaveLength(0);
  });
});

describe("undoImport", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const first = () => [header, ...dataLines.slice(0, 60)].join("\r\n");
  const second = () => [header, ...dataLines.slice(39)].join("\r\n");

  it("removes the import and all of its transactions", async () => {
    const { user, account } = await setup();
    const record = await importText(user.id, account.id, sampleText);

    const result = await undoImport(db, user.id, record.id);

    expect(result).toEqual({ deleted: record.rowsInserted });
    expect(await countTransactions(user.id)).toBe(0);
    expect(await listImports(db, user.id)).toHaveLength(0);
  });

  it("an undone import can be re-imported cleanly", async () => {
    const { user, account } = await setup();
    const record = await importText(user.id, account.id, sampleText);
    await undoImport(db, user.id, record.id);

    const again = await importText(user.id, account.id, sampleText);

    expect(again.rowsInserted).toBe(record.rowsInserted);
    expect(again.rowsDuplicate).toBe(0);
    expect(await countTransactions(user.id)).toBe(record.rowsInserted);
  });

  it("undoing the later of two overlapping imports keeps the earlier one intact", async () => {
    const { user, account } = await setup();
    const a = await importText(user.id, account.id, first());
    const b = await importText(user.id, account.id, second());

    expect(await undoImport(db, user.id, b.id)).toEqual({
      deleted: b.rowsInserted,
    });
    expect(await countTransactions(user.id)).toBe(a.rowsInserted);
  });

  it("undoing the earlier import keeps the later one's own rows, and re-importing restores it", async () => {
    const { user, account } = await setup();
    const union = prepare(sampleText, account.id).transactions.length;
    const a = await importText(user.id, account.id, first());
    const b = await importText(user.id, account.id, second());

    await undoImport(db, user.id, a.id);
    expect(await countTransactions(user.id)).toBe(b.rowsInserted);

    const again = await importText(user.id, account.id, first());
    expect(again.rowsInserted).toBe(a.rowsInserted);
    expect(await countTransactions(user.id)).toBe(union);
  });

  it("undoes an import that inserted nothing", async () => {
    const { user, account } = await setup();
    await importText(user.id, account.id, sampleText);
    const empty = await importText(user.id, account.id, sampleText);
    const before = await countTransactions(user.id);

    expect(await undoImport(db, user.id, empty.id)).toEqual({ deleted: 0 });
    expect(await countTransactions(user.id)).toBe(before);
  });

  it("returns null for an unknown id", async () => {
    const { user } = await setup();
    expect(await undoImport(db, user.id, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("user scoping", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("loadExistingDedupeKeys ignores other users' transactions", async () => {
    const a = await setup();
    const b = await setup();
    const prepared = prepare(sampleText, a.account.id);
    await importText(a.user.id, a.account.id, sampleText);
    const hashes = prepared.transactions.map((t) => t.dedupeHash);

    expect((await loadExistingDedupeKeys(db, a.user.id, a.account.id, hashes)).size).toBeGreaterThan(0);
    expect((await loadExistingDedupeKeys(db, b.user.id, a.account.id, hashes)).size).toBe(0);
    expect((await loadExistingDedupeKeys(db, b.user.id, b.account.id, hashes)).size).toBe(0);
    expect((await loadExistingDedupeKeys(db, a.user.id, a.account.id, [])).size).toBe(0);
  });

  it("getOwnedAccount returns only the caller's own account", async () => {
    const a = await setup();
    const b = await setup();
    expect((await getOwnedAccount(a.user.id, a.account.id))?.id).toBe(a.account.id);
    expect(await getOwnedAccount(a.user.id, b.account.id)).toBeNull();
  });

  it("undoImport cannot touch another user's import", async () => {
    const a = await setup();
    const b = await setup();
    const record = await importText(a.user.id, a.account.id, sampleText);

    expect(await undoImport(db, b.user.id, record.id)).toBeNull();
    expect(await countTransactions(a.user.id)).toBe(record.rowsInserted);
    expect(await listImports(db, a.user.id)).toHaveLength(1);
  });

  it("listImports returns only the caller's imports, newest first", async () => {
    const a = await setup();
    const b = await setup();
    const older = await importText(a.user.id, a.account.id, sampleText);
    const newer = await importText(a.user.id, a.account.id, sampleText);
    await importText(b.user.id, b.account.id, sampleText);

    expect((await listImports(db, a.user.id)).map((i) => i.id)).toEqual([newer.id, older.id]);
    expect(await listImports(db, b.user.id)).toHaveLength(1);
  });
});

describe("commitImport rule application", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function telecomCategory(userId: string) {
    const created = await createCategory(db, userId, {
      name: "Telecom test",
      color: "#00838f",
    });
    if (!created.ok) throw new Error("category not created");
    const rule = await createRule(db, userId, {
      categoryId: created.category.id,
      matchType: "contains",
      pattern: "horizon",
    });
    if (!rule) throw new Error("rule not created");
    return created.category;
  }

  it("categorizes matching new rows with source 'rule' and leaves the rest uncategorized", async () => {
    const { user, account } = await setup();
    const category = await telecomCategory(user.id);
    await importText(user.id, account.id, sampleText);

    const rows = await db.select().from(transactions).where(eq(transactions.userId, user.id));
    const matching = rows.filter((r) => r.labelNormalized?.includes("HORIZON"));
    expect(matching.length).toBeGreaterThan(0);
    for (const row of matching) {
      expect(row.categoryId).toBe(category.id);
      expect(row.categorySource).toBe("rule");
    }
    for (const row of rows.filter((r) => !matching.includes(r))) {
      expect(row.categoryId).toBeNull();
      expect(row.categorySource).toBeNull();
    }
  });

  it("re-import is idempotent and does not touch manually categorized rows", async () => {
    const { user, account } = await setup();
    const category = await telecomCategory(user.id);
    await importText(user.id, account.id, sampleText);

    const rows = await db.select().from(transactions).where(eq(transactions.userId, user.id));
    const telecom = rows.find((r) => r.categoryId === category.id);
    const other = rows.find((r) => r.categoryId === null);
    if (!telecom || !other) throw new Error("fixture rows missing");
    const [housing] = await db.select().from(categories).where(eq(categories.userId, user.id)).limit(1);
    await setTransactionCategory(db, user.id, telecom.id, housing.id);

    const second = await importText(user.id, account.id, sampleText);
    expect(second.rowsInserted).toBe(0);

    const after = await db.select().from(transactions).where(eq(transactions.userId, user.id));
    expect(after).toHaveLength(rows.length);
    const telecomAfter = after.find((r) => r.id === telecom.id);
    expect(telecomAfter?.categoryId).toBe(housing.id);
    expect(telecomAfter?.categorySource).toBe("manual");
    expect(after.find((r) => r.id === other.id)?.categoryId).toBeNull();
  });

  it("refuses to import into another user's account and inserts nothing", async () => {
    const owner = await setup();
    const intruder = await createTestUser();
    await provisionUserDefaults(db, intruder.id);
    await seedCategories(intruder.id);
    const prepared = prepare(sampleText, owner.account.id);

    await expect(
      commitImport(db, {
        userId: intruder.id,
        accountId: owner.account.id,
        filename: "export.csv",
        rowsTotal: prepared.rowsTotal,
        rowsError: 0,
        transactions: prepared.transactions,
      }),
    ).rejects.toBeInstanceOf(AccountNotOwnedError);

    expect(await db.select().from(transactions)).toHaveLength(0);
    expect(await db.select().from(imports)).toHaveLength(0);
  });
});
