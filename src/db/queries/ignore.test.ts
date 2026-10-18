// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { TransactionFilters } from "../../lib/transactions/filters";
import { db } from "../client";
import { imports, recurring, transactions, transfers } from "../schema";
import { createTestUser, resetDb, seedCategories } from "../test-utils";
import { createAccount, listAccounts } from "./accounts";
import { getAccountBalances, setAccountBalance } from "./balance";
import { getLatestTransactionMonth, getMonthlyHistory, getMonthTotals, getSpendingByCategory } from "./dashboard";
import { provisionUserDefaults } from "./provision";
import { refreshRecurring } from "./recurring";
import { countTransactions, listTransactions, setIgnored, sumTransactions } from "./transactions";
import { listTransferCandidates, refreshTransfers } from "./transfers";

let hashCounter = 0;

interface Row {
  date: string;
  amountCents: number;
  label?: string;
  categoryId?: string;
}

async function seed(
  userId: string,
  accountId: string,
  rows: Row[],
  source: "csv" | "sync" = "csv",
): Promise<string[]> {
  const [imp] = await db
    .insert(imports)
    .values({ userId, accountId, filename: "x.csv", rowsTotal: rows.length, rowsError: 0, kind: source })
    .returning();
  const inserted = await db
    .insert(transactions)
    .values(
      rows.map((r) => ({
        userId,
        accountId,
        importId: imp.id,
        source,
        date: r.date,
        amountCents: r.amountCents,
        labelRaw: r.label ?? "L",
        labelNormalized: r.label ?? "L",
        labelDisplay: r.label ?? "L",
        categoryId: r.categoryId ?? null,
        reviewedAt: null,
        dedupeHash: `ig${hashCounter++}`,
        occurrenceIndex: 0,
      })),
    )
    .returning({ id: transactions.id });
  return inserted.map((r) => r.id);
}

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  await seedCategories(user.id);
  const [main] = await listAccounts(user.id);
  const created = await createAccount(db, user.id, "Savings");
  if (!created.ok) throw new Error("createAccount failed");
  return { user, main, savings: created.account };
}

const MARCH = { from: "2026-03-01", to: "2026-03-31" };
const ALL: TransactionFilters = { direction: "all" };

describe("ignored transactions", () => {
  beforeEach(resetDb);

  it("leave month totals, history and spending by category", async () => {
    const { user, main } = await setup();
    const [cat] = await db.query.categories.findMany({ where: (c, { eq: e }) => e(c.userId, user.id), limit: 1 });
    const [keep, drop] = await seed(user.id, main.id, [
      { date: "2026-03-10", amountCents: -1000, categoryId: cat.id },
      { date: "2026-03-11", amountCents: -4000, categoryId: cat.id },
    ]);
    await seed(user.id, main.id, [{ date: "2026-04-02", amountCents: -500 }]);
    expect(await setIgnored(db, user.id, [drop], true)).toEqual([drop]);

    expect(await getMonthTotals(db, user.id, MARCH)).toMatchObject({ spentCents: 1000, count: 1 });
    const spending = await getSpendingByCategory(db, user.id, MARCH);
    expect(spending.reduce((sum, s) => sum + s.spentCents, 0)).toBe(1000);
    expect((await getMonthlyHistory(db, user.id)).find((m) => m.month === "2026-03")).toMatchObject({ spentCents: 1000, count: 1 });

    await setIgnored(db, user.id, [keep], true);
    expect((await getMonthlyHistory(db, user.id)).map((m) => m.month)).toEqual(["2026-04"]);

    // Stopping brings it back.
    await setIgnored(db, user.id, [drop, keep], false);
    expect(await getMonthTotals(db, user.id, MARCH)).toMatchObject({ spentCents: 5000, count: 2 });
  });

  it("don't count as the latest month", async () => {
    const { user, main } = await setup();
    await seed(user.id, main.id, [{ date: "2026-03-10", amountCents: -1000 }]);
    const [later] = await seed(user.id, main.id, [{ date: "2026-05-10", amountCents: -1000 }]);
    await setIgnored(db, user.id, [later], true);
    expect(await getLatestTransactionMonth(db, user.id)).toBe("2026-03");
  });

  it("leave the account balance", async () => {
    const { user, main } = await setup();
    await setAccountBalance(db, user.id, main.id, { startingBalanceCents: 100000, startingBalanceDate: "2026-03-01", thresholdCents: 0 });
    const [, drop] = await seed(user.id, main.id, [
      { date: "2026-03-10", amountCents: -1000 },
      { date: "2026-03-12", amountCents: -4000 },
    ]);
    await setIgnored(db, user.id, [drop], true);
    const [row] = await getAccountBalances(db, user.id);
    expect(row).toMatchObject({ balanceCents: 99000, asOf: "2026-03-10" });
  });

  it("don't feed recurring detection", async () => {
    const { user, main } = await setup();
    const ids = await seed(user.id, main.id, [
      { date: "2025-07-05", amountCents: -1999, label: "PRLV ORANGE SA" },
      { date: "2025-08-05", amountCents: -1999, label: "PRLV ORANGE SA" },
      { date: "2025-09-05", amountCents: -1999, label: "PRLV ORANGE SA" },
    ]);
    await refreshRecurring(db, user.id);
    expect(await db.select().from(recurring).where(eq(recurring.userId, user.id))).toHaveLength(1);

    // Two charges left: no longer a pattern, and the ignored row loses its link.
    await setIgnored(db, user.id, [ids[2]], true);
    await refreshRecurring(db, user.id);
    expect(await db.select().from(recurring).where(eq(recurring.userId, user.id))).toHaveLength(0);
    const [row] = await db.select().from(transactions).where(eq(transactions.id, ids[2]));
    expect(row.recurringId).toBeNull();
  });

  it("are never paired as a transfer, nor offered as the other leg", async () => {
    const { user, main, savings } = await setup();
    const [out] = await seed(user.id, main.id, [{ date: "2026-03-10", amountCents: -5000 }]);
    const [inn] = await seed(user.id, savings.id, [{ date: "2026-03-11", amountCents: 5000 }]);
    await setIgnored(db, user.id, [inn], true);

    expect(await refreshTransfers(db, user.id)).toBe(0);
    expect(await listTransferCandidates(db, user.id, out)).toEqual([]);

    await setIgnored(db, user.id, [inn], false);
    expect(await refreshTransfers(db, user.id)).toBe(1);
  });

  it("can't be set on a transfer leg", async () => {
    const { user, main, savings } = await setup();
    const [out] = await seed(user.id, main.id, [{ date: "2026-03-10", amountCents: -5000 }]);
    await seed(user.id, savings.id, [{ date: "2026-03-11", amountCents: 5000 }]);
    await refreshTransfers(db, user.id);
    expect(await db.select().from(transfers)).toHaveLength(1);
    expect(await setIgnored(db, user.id, [out], true)).toEqual([]);
  });
});

describe("setIgnored", () => {
  beforeEach(resetDb);

  it("marks the row reviewed, keeps the first ignored_at, and leaves reviewed_at when stopping", async () => {
    const { user, main } = await setup();
    const [id] = await seed(user.id, main.id, [{ date: "2026-03-10", amountCents: -1000 }]);
    const get = async () => (await db.select().from(transactions).where(eq(transactions.id, id)))[0];
    expect((await get()).reviewedAt).toBeNull();

    await setIgnored(db, user.id, [id], true);
    const first = await get();
    expect(first.ignoredAt).not.toBeNull();
    expect(first.reviewedAt).not.toBeNull();

    await setIgnored(db, user.id, [id], true);
    expect((await get()).ignoredAt).toEqual(first.ignoredAt);

    await setIgnored(db, user.id, [id], false);
    const after = await get();
    expect(after.ignoredAt).toBeNull();
    expect(after.reviewedAt).toEqual(first.reviewedAt);
  });

  it("is scoped by user", async () => {
    const { user, main } = await setup();
    const other = await createTestUser();
    const [id] = await seed(user.id, main.id, [{ date: "2026-03-10", amountCents: -1000 }]);
    expect(await setIgnored(db, other.id, [id], true)).toEqual([]);
    const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
    expect(row.ignoredAt).toBeNull();
    expect(row.reviewedAt).toBeNull();
    expect(await setIgnored(db, user.id, [], true)).toEqual([]);
  });
});

describe("the ignored filter", () => {
  beforeEach(resetDb);

  it("hides by default, and shows or isolates ignored rows on request", async () => {
    const { user, main } = await setup();
    const [keep, drop] = await seed(user.id, main.id, [
      { date: "2026-03-10", amountCents: -1000 },
      { date: "2026-03-11", amountCents: -4000 },
    ]);
    await setIgnored(db, user.id, [drop], true);

    const ids = async (f: TransactionFilters) => (await listTransactions(db, user.id, f, null)).items.map((i) => i.id);
    expect(await ids(ALL)).toEqual([keep]);
    expect(await ids({ ...ALL, ignored: "show" })).toEqual([drop, keep]);
    expect(await ids({ ...ALL, ignored: "only" })).toEqual([drop]);

    expect(await countTransactions(db, user.id, ALL)).toBe(1);
    expect(await countTransactions(db, user.id, { ...ALL, ignored: "only" })).toBe(1);
    expect(await sumTransactions(db, user.id, ALL)).toEqual({ outCents: -1000, inCents: 0 });

    const [item] = (await listTransactions(db, user.id, { ...ALL, ignored: "only" }, null)).items;
    expect(item.ignored).toBe(true);
  });
});

describe("list item origin", () => {
  beforeEach(resetDb);

  it("tells CSV rows from synced rows and carries the import time", async () => {
    const { user, main } = await setup();
    const [csv] = await seed(user.id, main.id, [{ date: "2026-03-10", amountCents: -1000 }], "csv");
    const [sync] = await seed(user.id, main.id, [{ date: "2026-03-11", amountCents: -2000 }], "sync");
    const items = (await listTransactions(db, user.id, ALL, null)).items;
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get(csv)?.origin.source).toBe("csv");
    expect(byId.get(sync)?.origin.source).toBe("sync");
    expect(byId.get(csv)?.origin.importedAt).toBeInstanceOf(Date);
  });
});
