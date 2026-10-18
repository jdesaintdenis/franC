// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { accounts, imports, recurring, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import {
  createAccount,
  deleteAccount,
  getLastUsedAccountId,
  listAccounts,
  listAccountsWithStats,
  renameAccount,
} from "./accounts";
import {
  getLatestTransactionMonth,
  getMonthlyTrend,
  getMonthTotals,
  getSpendingByCategory,
  getSubcategorySpending,
} from "./dashboard";
import { AccountNotOwnedError, commitImport, listImports } from "./imports";
import { provisionUserDefaults } from "./provision";
import { listRecurring, refreshRecurring, setRecurringStatus } from "./recurring";
import { countTransactions, listTransactions } from "./transactions";

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [main] = await listAccounts(user.id);
  return { user, main };
}

async function newAccount(userId: string, name: string) {
  const result = await createAccount(db, userId, name);
  if (!result.ok) throw new Error(`createAccount failed: ${result.error}`);
  return result.account;
}

let hashCounter = 0;

interface Row {
  date: string;
  amountCents: number;
  label: string;
}

async function seed(userId: string, accountId: string, rows: Row[], uploadedAt?: Date): Promise<string> {
  const [imp] = await db
    .insert(imports)
    .values({ userId, accountId, filename: "x.csv", rowsTotal: rows.length, rowsError: 0, uploadedAt })
    .returning();
  if (rows.length > 0) {
    await db.insert(transactions).values(
      rows.map((r) => ({
        userId,
        accountId,
        importId: imp.id,
        date: r.date,
        amountCents: r.amountCents,
        labelRaw: r.label,
        labelNormalized: r.label,
        labelDisplay: r.label,
        dedupeHash: `m${hashCounter++}`,
        occurrenceIndex: 0,
      })),
    );
  }
  return imp.id;
}

const netflix = (year: number): Row[] => [
  { date: `${year}-07-05`, amountCents: -1299, label: "PRLV NETFLIX" },
  { date: `${year}-08-05`, amountCents: -1299, label: "PRLV NETFLIX" },
  { date: `${year}-09-05`, amountCents: -1299, label: "PRLV NETFLIX" },
];

describe("account CRUD", () => {
  beforeEach(resetDb);

  it("creates an account with a trimmed name", async () => {
    const { user } = await setup();
    const account = await newAccount(user.id, "  Joint account ");
    expect(account).toMatchObject({ name: "Joint account", userId: user.id });
    expect(await listAccounts(user.id)).toHaveLength(2);
  });

  it("validates length and rejects duplicates case-insensitively", async () => {
    const { user } = await setup();
    expect(await createAccount(db, user.id, "   ")).toEqual({ ok: false, error: "required" });
    expect(await createAccount(db, user.id, "x".repeat(51))).toEqual({ ok: false, error: "tooLong" });
    await newAccount(user.id, "Joint");
    expect(await createAccount(db, user.id, " jOINT ")).toEqual({ ok: false, error: "nameTaken" });
    expect(await createAccount(db, user.id, "main account")).toEqual({ ok: false, error: "nameTaken" });
  });

  it("lets two users use the same name", async () => {
    const a = await setup();
    const b = await setup();
    await newAccount(a.user.id, "Joint");
    expect((await createAccount(db, b.user.id, "Joint")).ok).toBe(true);
  });

  it("is race-safe: concurrent creates with the same name yield one account", async () => {
    const { user } = await setup();
    const results = await Promise.all([
      createAccount(db, user.id, "Race"),
      createAccount(db, user.id, "race"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "nameTaken")).toHaveLength(1);
  });

  it("renames, allows a case-only change of its own name, and rejects a taken name", async () => {
    const { user, main } = await setup();
    const joint = await newAccount(user.id, "Joint");
    const renamed = await renameAccount(db, user.id, joint.id, "  Savings ");
    expect(renamed).toMatchObject({ ok: true, account: { name: "Savings" } });
    expect(await renameAccount(db, user.id, main.id, "SAVINGS")).toEqual({ ok: false, error: "nameTaken" });
    expect(await renameAccount(db, user.id, joint.id, "SAVINGS")).toMatchObject({
      ok: true,
      account: { name: "SAVINGS" },
    });
    expect(await renameAccount(db, user.id, joint.id, " ")).toEqual({ ok: false, error: "required" });
  });

  it("does not rename or delete another user's account", async () => {
    const a = await setup();
    const b = await setup();
    const extra = await newAccount(a.user.id, "Extra");
    expect(await renameAccount(db, b.user.id, extra.id, "Hacked")).toEqual({ ok: false, error: "notFound" });
    expect(await deleteAccount(db, b.user.id, extra.id)).toEqual({ ok: false, error: "notFound" });
    const [stored] = await db.select().from(accounts).where(eq(accounts.id, extra.id));
    expect(stored.name).toBe("Extra");
  });

  it("refuses to delete the last account", async () => {
    const { user, main } = await setup();
    expect(await deleteAccount(db, user.id, main.id)).toEqual({ ok: false, error: "lastAccount" });
    expect(await listAccounts(user.id)).toHaveLength(1);
  });

  it("returns notFound for an unknown id", async () => {
    const { user } = await setup();
    await newAccount(user.id, "Extra");
    expect(await deleteAccount(db, user.id, "00000000-0000-4000-8000-000000000000")).toEqual({
      ok: false,
      error: "notFound",
    });
  });

  it("cascades imports, transactions and recurring items and returns counts", async () => {
    const { user, main } = await setup();
    const joint = await newAccount(user.id, "Joint");
    await seed(user.id, main.id, netflix(2025));
    await seed(user.id, joint.id, netflix(2025));
    await seed(user.id, joint.id, [{ date: "2025-09-10", amountCents: -500, label: "COFFEE" }]);
    await refreshRecurring(db, user.id);
    expect(await db.select().from(recurring).where(eq(recurring.userId, user.id))).toHaveLength(2);

    expect(await deleteAccount(db, user.id, joint.id)).toEqual({ ok: true, imports: 2, transactions: 4 });

    const items = await db.select().from(recurring).where(eq(recurring.userId, user.id));
    expect(items).toHaveLength(1);
    expect(items[0].accountId).toBe(main.id);
    expect(await db.select().from(transactions).where(eq(transactions.accountId, joint.id))).toEqual([]);
    expect(await db.select().from(imports).where(eq(imports.accountId, joint.id))).toEqual([]);
    // The other account is untouched.
    expect(await db.select().from(transactions).where(eq(transactions.accountId, main.id))).toHaveLength(3);
  });
});

describe("listAccountsWithStats and getLastUsedAccountId", () => {
  beforeEach(resetDb);

  it("reports counts and last import date per account, without multiplying joins", async () => {
    const { user, main } = await setup();
    const joint = await newAccount(user.id, "Joint");
    await seed(user.id, main.id, netflix(2025), new Date("2025-01-01T10:00:00Z"));
    await seed(user.id, main.id, [{ date: "2025-09-10", amountCents: -500, label: "COFFEE" }], new Date("2025-02-01T10:00:00Z"));

    const stats = await listAccountsWithStats(db, user.id);
    expect(stats.map((s) => s.name)).toEqual(["Main account", "Joint"]);
    expect(stats[0]).toMatchObject({ id: main.id, transactionCount: 4, importCount: 2 });
    expect(stats[0].lastImportAt?.toISOString()).toBe("2025-02-01T10:00:00.000Z");
    expect(stats[1]).toMatchObject({ id: joint.id, transactionCount: 0, importCount: 0, lastImportAt: null });
  });

  it("is scoped by user", async () => {
    const a = await setup();
    const b = await setup();
    await seed(a.user.id, a.main.id, netflix(2025));
    const stats = await listAccountsWithStats(db, b.user.id);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ id: b.main.id, transactionCount: 0 });
  });

  it("returns the account of the most recent import, or null", async () => {
    const { user, main } = await setup();
    const joint = await newAccount(user.id, "Joint");
    expect(await getLastUsedAccountId(db, user.id)).toBeNull();
    await seed(user.id, joint.id, [], new Date("2025-01-01T00:00:00Z"));
    await seed(user.id, main.id, [], new Date("2025-03-01T00:00:00Z"));
    expect(await getLastUsedAccountId(db, user.id)).toBe(main.id);
    await seed(user.id, joint.id, [], new Date("2025-04-01T00:00:00Z"));
    expect(await getLastUsedAccountId(db, user.id)).toBe(joint.id);
  });

  it("ignores another user's imports", async () => {
    const a = await setup();
    const b = await setup();
    await seed(a.user.id, a.main.id, []);
    expect(await getLastUsedAccountId(db, b.user.id)).toBeNull();
  });
});

describe("imports with accounts", () => {
  beforeEach(resetDb);

  it("listImports returns the account name", async () => {
    const { user, main } = await setup();
    const joint = await newAccount(user.id, "Joint");
    await seed(user.id, main.id, [], new Date("2025-01-01T00:00:00Z"));
    await seed(user.id, joint.id, [], new Date("2025-02-01T00:00:00Z"));
    const list = await listImports(db, user.id);
    expect(list.map((i) => i.accountName)).toEqual(["Joint", "Main account"]);
  });

  it("refuses to import into another user's account", async () => {
    const a = await setup();
    const b = await setup();
    await expect(
      commitImport(db, {
        userId: b.user.id,
        accountId: a.main.id,
        filename: "x.csv",
        rowsTotal: 0,
        rowsError: 0,
        transactions: [],
      }),
    ).rejects.toBeInstanceOf(AccountNotOwnedError);
    expect(await db.select().from(imports).where(eq(imports.userId, b.user.id))).toEqual([]);
  });
});

describe("transactions filtered by account", () => {
  beforeEach(resetDb);

  it("filters list and count, and rows carry the account", async () => {
    const { user, main } = await setup();
    const joint = await newAccount(user.id, "Joint");
    await seed(user.id, main.id, [{ date: "2025-09-01", amountCents: -100, label: "A" }]);
    await seed(user.id, joint.id, [
      { date: "2025-09-02", amountCents: -200, label: "B" },
      { date: "2025-09-03", amountCents: -300, label: "C" },
    ]);

    const all = await listTransactions(db, user.id, { direction: "all" }, null);
    expect(all.items).toHaveLength(3);
    expect(all.items.find((i) => i.label === "A")).toMatchObject({ accountId: main.id, accountName: "Main account" });

    const onJoint = { direction: "all" as const, account: joint.id };
    const listed = await listTransactions(db, user.id, onJoint, null);
    expect(listed.items.map((i) => i.label)).toEqual(["C", "B"]);
    expect(listed.items.every((i) => i.accountName === "Joint")).toBe(true);
    expect(await countTransactions(db, user.id, onJoint)).toBe(2);
    expect(await countTransactions(db, user.id, { direction: "all" })).toBe(3);
  });

  it("returns nothing when filtering by another user's account", async () => {
    const a = await setup();
    const b = await setup();
    await seed(a.user.id, a.main.id, netflix(2025));
    const foreign = { direction: "all" as const, account: a.main.id };
    expect((await listTransactions(db, b.user.id, foreign, null)).items).toEqual([]);
    expect(await countTransactions(db, b.user.id, foreign)).toBe(0);
  });
});

describe("dashboard filtered by account", () => {
  beforeEach(resetDb);

  it("narrows every query to the account", async () => {
    const { user, main } = await setup();
    const joint = await newAccount(user.id, "Joint");
    await seed(user.id, main.id, [
      { date: "2025-09-01", amountCents: -1000, label: "A" },
      { date: "2025-09-02", amountCents: 5000, label: "PAY" },
    ]);
    await seed(user.id, joint.id, [{ date: "2025-10-03", amountCents: -300, label: "B" }]);
    const range = { from: "2025-09-01", to: "2025-09-30" };

    expect(await getMonthTotals(db, user.id, range)).toMatchObject({ spentCents: 1000, count: 2 });
    expect(await getMonthTotals(db, user.id, range, { accountId: main.id })).toMatchObject({
      spentCents: 1000,
      incomeCents: 5000,
      count: 2,
    });
    expect(await getMonthTotals(db, user.id, range, { accountId: joint.id })).toMatchObject({ count: 0 });

    const cats = await getSpendingByCategory(db, user.id, { from: "2025-09-01", to: "2025-10-31" }, { accountId: joint.id });
    expect(cats.reduce((sum, c) => sum + c.spentCents, 0)).toBe(300);

    const trend = await getMonthlyTrend(db, user.id, "2025-09", "2025-10", { accountId: joint.id });
    expect(trend).toEqual([{ month: "2025-10", spentCents: 300, incomeCents: 0 }]);

    expect(await getLatestTransactionMonth(db, user.id)).toBe("2025-10");
    expect(await getLatestTransactionMonth(db, user.id, { accountId: main.id })).toBe("2025-09");
  });

  it("returns none of another user's data for a foreign account id", async () => {
    const a = await setup();
    const b = await setup();
    await seed(a.user.id, a.main.id, [{ date: "2025-09-01", amountCents: -1000, label: "A" }]);
    const scope = { accountId: a.main.id };
    const range = { from: "2025-09-01", to: "2025-09-30" };
    expect(await getMonthTotals(db, b.user.id, range, scope)).toMatchObject({ spentCents: 0, count: 0 });
    expect(await getSpendingByCategory(db, b.user.id, range, scope)).toEqual([]);
    expect(await getMonthlyTrend(db, b.user.id, "2025-01", "2025-12", scope)).toEqual([]);
    expect(await getLatestTransactionMonth(db, b.user.id, scope)).toBeNull();
    expect(
      await getSubcategorySpending(db, b.user.id, range, "00000000-0000-4000-8000-000000000000", scope),
    ).toBeNull();
  });
});

describe("recurring per account", () => {
  beforeEach(resetDb);

  it("gives the same merchant on two accounts two items", async () => {
    const { user, main } = await setup();
    const joint = await newAccount(user.id, "Joint");
    await seed(user.id, main.id, netflix(2025));
    await seed(user.id, joint.id, netflix(2025));

    expect(await refreshRecurring(db, user.id)).toEqual({ detected: 2, updated: 0, removed: 0, priceAlerts: 0 });
    const items = await listRecurring(db, user.id);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.accountName).sort()).toEqual(["Joint", "Main account"]);
    for (const item of items) {
      const linked = await db
        .select({ accountId: transactions.accountId })
        .from(transactions)
        .where(and(eq(transactions.userId, user.id), eq(transactions.recurringId, item.id)));
      expect(linked).toHaveLength(3);
      expect(linked.every((l) => l.accountId === item.accountId)).toBe(true);
    }
    // Idempotent.
    expect(await refreshRecurring(db, user.id)).toEqual({ detected: 0, updated: 2, removed: 0, priceAlerts: 0 });
  });

  it("filters the list by account and ignores another user's account", async () => {
    const a = await setup();
    const b = await setup();
    const joint = await newAccount(a.user.id, "Joint");
    await seed(a.user.id, a.main.id, netflix(2025));
    await seed(a.user.id, joint.id, netflix(2025));
    await refreshRecurring(db, a.user.id);

    const onJoint = await listRecurring(db, a.user.id, { accountId: joint.id });
    expect(onJoint).toHaveLength(1);
    expect(onJoint[0]).toMatchObject({ accountId: joint.id, accountName: "Joint" });
    expect(await listRecurring(db, b.user.id, { accountId: a.main.id })).toEqual([]);
  });

  it("dismissing on one account keeps the other and stays final", async () => {
    const { user, main } = await setup();
    const joint = await newAccount(user.id, "Joint");
    await seed(user.id, main.id, netflix(2025));
    await seed(user.id, joint.id, netflix(2025));
    await refreshRecurring(db, user.id);
    const [onMain] = await listRecurring(db, user.id, { accountId: main.id });

    await setRecurringStatus(db, user.id, onMain.id, "dismissed");
    await refreshRecurring(db, user.id);

    const remaining = await listRecurring(db, user.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].accountId).toBe(joint.id);
    const rows = await db.select().from(recurring).where(eq(recurring.userId, user.id));
    expect(rows.find((r) => r.accountId === main.id)?.status).toBe("dismissed");
  });

  it("uses the latest date across all accounts as the reference", async () => {
    const { user, main } = await setup();
    const joint = await newAccount(user.id, "Joint");
    // Monthly payments stopped in September 2024; another account has activity a year later.
    await seed(user.id, main.id, netflix(2024));
    await seed(user.id, joint.id, [{ date: "2025-09-10", amountCents: -500, label: "COFFEE" }]);
    expect(await refreshRecurring(db, user.id)).toEqual({ detected: 0, updated: 0, removed: 0, priceAlerts: 0 });
    expect(await listRecurring(db, user.id)).toEqual([]);

    // Control: alone, the same account's items are current, so the global date matters.
    const solo = await setup();
    await seed(solo.user.id, solo.main.id, netflix(2024));
    expect((await refreshRecurring(db, solo.user.id)).detected).toBe(1);
  });

  it("deletes a confirmed item whose account group is gone even if another account has the merchant", async () => {
    const { user, main } = await setup();
    const joint = await newAccount(user.id, "Joint");
    const importOnMain = await seed(user.id, main.id, netflix(2025));
    await seed(user.id, joint.id, netflix(2025));
    await refreshRecurring(db, user.id);
    const [onMain] = await listRecurring(db, user.id, { accountId: main.id });
    await setRecurringStatus(db, user.id, onMain.id, "confirmed");

    await db.delete(imports).where(eq(imports.id, importOnMain));
    const result = await refreshRecurring(db, user.id);
    expect(result.removed).toBe(1);
    const left = await listRecurring(db, user.id);
    expect(left).toHaveLength(1);
    expect(left[0].accountId).toBe(joint.id);
  });
});
