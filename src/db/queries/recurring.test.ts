// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { categories, imports, recurring, transactions } from "../schema";
import { createTestUser, resetDb, seedCategories } from "../test-utils";
import { listAccounts } from "./accounts";
import { undoImport } from "./imports";
import { provisionUserDefaults } from "./provision";
import { listRecurring, refreshRecurring, setRecurringStatus } from "./recurring";

interface Row {
  date: string;
  amountCents: number;
  label: string;
}

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  await seedCategories(user.id);
  const [account] = await listAccounts(user.id);
  return { user, account };
}

let hashCounter = 0;

/** One import holding all rows; returns the import id. */
async function seed(userId: string, accountId: string, rows: Row[]): Promise<string> {
  const [imp] = await db
    .insert(imports)
    .values({ userId, accountId, filename: "x.csv", rowsTotal: rows.length, rowsError: 0 })
    .returning();
  await db.insert(transactions).values(
    rows.map((r) => ({
      userId,
      accountId,
      importId: imp.id,
      date: r.date,
      amountCents: r.amountCents,
      labelRaw: r.label,
      labelNormalized: r.label,
      labelDisplay: `Display ${r.label}`,
      dedupeHash: `h${hashCounter++}`,
      occurrenceIndex: 0,
    })),
  );
  return imp.id;
}

const orange: Row[] = [
  { date: "2025-07-05", amountCents: -1999, label: "PRLV ORANGE SA" },
  { date: "2025-08-05", amountCents: -1999, label: "PRLV ORANGE SA" },
  { date: "2025-09-05", amountCents: -2099, label: "PRLV ORANGE SA" },
];

const salary: Row[] = [
  { date: "2025-07-28", amountCents: 250000, label: "VIR SEPA ACME PAYROLL" },
  { date: "2025-08-28", amountCents: 250000, label: "VIR SEPA ACME PAYROLL" },
  { date: "2025-09-28", amountCents: 250000, label: "VIR SEPA ACME PAYROLL" },
];

const linkedIds = async (userId: string, recurringId: string) =>
  (
    await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.recurringId, recurringId)))
  ).length;

describe("refreshRecurring", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("inserts detected items with interval, amount, dates and links", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, [...orange, ...salary]);

    const result = await refreshRecurring(db, user.id);
    expect(result).toEqual({ detected: 2, updated: 0, removed: 0, priceAlerts: 0 });

    const rows = await db.select().from(recurring).where(eq(recurring.userId, user.id));
    const o = rows.find((r) => r.merchantKey === "ORANGE SA");
    expect(o).toMatchObject({
      interval: "monthly",
      typicalAmountCents: -1999,
      lastSeenDate: "2025-09-05",
      nextExpectedDate: "2025-10-05",
      status: "detected",
    });
    const s = rows.find((r) => r.typicalAmountCents === 250000);
    expect(s).toMatchObject({ interval: "monthly", lastSeenDate: "2025-09-28" });
    expect(await linkedIds(user.id, o!.id)).toBe(3);
    expect(await linkedIds(user.id, s!.id)).toBe(3);
  });

  it("is idempotent", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, orange);
    await refreshRecurring(db, user.id);
    const before = await db.select().from(recurring).where(eq(recurring.userId, user.id));

    const result = await refreshRecurring(db, user.id);
    expect(result).toEqual({ detected: 0, updated: 1, removed: 0, priceAlerts: 0 });
    const after = await db.select().from(recurring).where(eq(recurring.userId, user.id));
    expect(after).toEqual(before);
    expect(await linkedIds(user.id, before[0].id)).toBe(3);
  });

  it("does nothing harmful for a user without transactions", async () => {
    const { user } = await setup();
    expect(await refreshRecurring(db, user.id)).toEqual({ detected: 0, updated: 0, removed: 0, priceAlerts: 0 });
  });

  it("never re-suggests a dismissed item and clears its links", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, orange);
    await refreshRecurring(db, user.id);
    const [item] = await db.select().from(recurring).where(eq(recurring.userId, user.id));

    expect(await setRecurringStatus(db, user.id, item.id, "dismissed")).toMatchObject({
      status: "dismissed",
    });
    expect(await linkedIds(user.id, item.id)).toBe(0);

    const result = await refreshRecurring(db, user.id);
    expect(result).toEqual({ detected: 0, updated: 0, removed: 0, priceAlerts: 0 });
    const rows = await db.select().from(recurring).where(eq(recurring.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: item.id, status: "dismissed" });
    expect(await linkedIds(user.id, item.id)).toBe(0);
    expect(await listRecurring(db, user.id)).toEqual([]);
  });

  it("keeps a confirmed item after its data stops qualifying", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, orange);
    // A later import adds a fourth payment; undoing it later must not drop the item.
    const later = await seed(user.id, account.id, [
      { date: "2025-10-05", amountCents: -2099, label: "PRLV ORANGE SA" },
    ]);
    await refreshRecurring(db, user.id);
    const [item] = await db.select().from(recurring).where(eq(recurring.userId, user.id));
    await setRecurringStatus(db, user.id, item.id, "confirmed");

    // Two remaining rows are below the 3-occurrence minimum.
    const oldest = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, user.id), eq(transactions.date, "2025-07-05")));
    await db.delete(transactions).where(eq(transactions.id, oldest[0].id));
    await undoImport(db, user.id, later);

    await refreshRecurring(db, user.id);
    const [after] = await db.select().from(recurring).where(eq(recurring.userId, user.id));
    expect(after).toMatchObject({
      id: item.id,
      status: "confirmed",
      interval: "monthly",
      lastSeenDate: "2025-09-05",
      nextExpectedDate: "2025-10-05",
    });
    expect(await linkedIds(user.id, item.id)).toBe(2);
  });

  it("removes a confirmed item when all its transactions are gone", async () => {
    const { user, account } = await setup();
    const orangeImport = await seed(user.id, account.id, orange);
    await seed(user.id, account.id, salary);
    await refreshRecurring(db, user.id);
    const items = await db.select().from(recurring).where(eq(recurring.userId, user.id));
    const orangeItem = items.find((i) => i.typicalAmountCents < 0);
    const salaryItem = items.find((i) => i.typicalAmountCents > 0);
    if (!orangeItem || !salaryItem) throw new Error("expected both items");
    await setRecurringStatus(db, user.id, orangeItem.id, "confirmed");
    await setRecurringStatus(db, user.id, salaryItem.id, "confirmed");

    await undoImport(db, user.id, orangeImport);
    const result = await refreshRecurring(db, user.id);
    expect(result).toEqual({ detected: 0, updated: 1, removed: 1, priceAlerts: 0 });
    const after = await db.select().from(recurring).where(eq(recurring.userId, user.id));
    expect(after.map((i) => i.id)).toEqual([salaryItem.id]);
  });

  it("removes confirmed items but keeps dismissed ones when no transactions are left", async () => {
    const { user, account } = await setup();
    const importId = await seed(user.id, account.id, [...orange, ...salary]);
    await refreshRecurring(db, user.id);
    const items = await db.select().from(recurring).where(eq(recurring.userId, user.id));
    const orangeItem = items.find((i) => i.typicalAmountCents < 0);
    const salaryItem = items.find((i) => i.typicalAmountCents > 0);
    if (!orangeItem || !salaryItem) throw new Error("expected both items");
    await setRecurringStatus(db, user.id, orangeItem.id, "confirmed");
    await setRecurringStatus(db, user.id, salaryItem.id, "dismissed");

    await undoImport(db, user.id, importId);
    expect(await refreshRecurring(db, user.id)).toEqual({ detected: 0, updated: 0, removed: 1, priceAlerts: 0 });
    const after = await db.select().from(recurring).where(eq(recurring.userId, user.id));
    expect(after).toMatchObject([{ id: salaryItem.id, status: "dismissed" }]);
  });

  it("removes a detected item after undoImport and refresh", async () => {
    const { user, account } = await setup();
    const importId = await seed(user.id, account.id, orange);
    await refreshRecurring(db, user.id);
    await undoImport(db, user.id, importId);
    await seed(user.id, account.id, [
      { date: "2025-09-10", amountCents: -500, label: "SOMETHING ELSE" },
    ]);

    const result = await refreshRecurring(db, user.id);
    expect(result).toEqual({ detected: 0, updated: 0, removed: 1, priceAlerts: 0 });
    expect(await db.select().from(recurring).where(eq(recurring.userId, user.id))).toEqual([]);
  });

  it("removes detected items when the user has no transactions left", async () => {
    const { user, account } = await setup();
    const importId = await seed(user.id, account.id, orange);
    await refreshRecurring(db, user.id);
    await undoImport(db, user.id, importId);

    expect(await refreshRecurring(db, user.id)).toEqual({ detected: 0, updated: 0, removed: 1, priceAlerts: 0 });
  });

  it("leaves another user's data untouched", async () => {
    const a = await setup();
    const b = await setup();
    await seed(a.user.id, a.account.id, orange);
    await seed(b.user.id, b.account.id, orange);
    await refreshRecurring(db, b.user.id);
    const [itemB] = await db.select().from(recurring).where(eq(recurring.userId, b.user.id));

    await refreshRecurring(db, a.user.id);
    const [itemA] = await db.select().from(recurring).where(eq(recurring.userId, a.user.id));
    expect(itemA.id).not.toBe(itemB.id);
    expect(await linkedIds(b.user.id, itemB.id)).toBe(3);
    expect(await linkedIds(a.user.id, itemA.id)).toBe(3);

    // A dismissed item for A does not affect B's identical merchant.
    await setRecurringStatus(db, a.user.id, itemA.id, "dismissed");
    await refreshRecurring(db, b.user.id);
    const [stillB] = await db.select().from(recurring).where(eq(recurring.userId, b.user.id));
    expect(stillB).toMatchObject({ id: itemB.id, status: "detected" });
  });
});

describe("listRecurring", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("orders confirmed first, then by next expected date, and names by latest label", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, [...orange, ...salary]);
    await refreshRecurring(db, user.id);
    const items = await listRecurring(db, user.id);
    expect(items.map((i) => i.merchantKey)).toEqual(["ORANGE SA", "ACME PAYROLL"]);
    expect(items[0].name).toBe("Display PRLV ORANGE SA");

    await setRecurringStatus(db, user.id, items[1].id, "confirmed");
    const reordered = await listRecurring(db, user.id);
    expect(reordered.map((i) => i.merchantKey)).toEqual(["ACME PAYROLL", "ORANGE SA"]);
  });

  it("does not list another user's or dismissed items", async () => {
    const a = await setup();
    const b = await setup();
    await seed(a.user.id, a.account.id, orange);
    await seed(b.user.id, b.account.id, salary);
    await refreshRecurring(db, a.user.id);
    await refreshRecurring(db, b.user.id);

    const listedA = await listRecurring(db, a.user.id);
    expect(listedA.every((i) => i.userId === a.user.id)).toBe(true);
    await setRecurringStatus(db, a.user.id, listedA[0].id, "dismissed");
    expect(await listRecurring(db, a.user.id)).toEqual([]);
  });
});

describe("setRecurringStatus", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns null for another user's id and for dismissed items", async () => {
    const a = await setup();
    const b = await setup();
    await seed(a.user.id, a.account.id, orange);
    await refreshRecurring(db, a.user.id);
    const [item] = await db.select().from(recurring).where(eq(recurring.userId, a.user.id));

    expect(await setRecurringStatus(db, b.user.id, item.id, "confirmed")).toBeNull();
    expect(await setRecurringStatus(db, b.user.id, item.id, "dismissed")).toBeNull();
    expect(await linkedIds(a.user.id, item.id)).toBe(3);

    await setRecurringStatus(db, a.user.id, item.id, "dismissed");
    expect(await setRecurringStatus(db, a.user.id, item.id, "confirmed")).toBeNull();
    const [after] = await db.select().from(recurring).where(eq(recurring.id, item.id));
    expect(after.status).toBe("dismissed");
  });
});

describe("listRecurring categoryId", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function categoryId(userId: string, name: string): Promise<string> {
    const [row] = await db.select().from(categories).where(and(eq(categories.userId, userId), eq(categories.name, name)));
    return row.id;
  }

  it("is the category of the latest linked charge, null without one", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, orange);
    await refreshRecurring(db, user.id);
    expect((await listRecurring(db, user.id))[0].categoryId).toBeNull();

    const housing = await categoryId(user.id, "Housing");
    const leisure = await categoryId(user.id, "Leisure");
    const rows = await db.select().from(transactions).where(eq(transactions.userId, user.id));
    const sorted = rows.sort((x, y) => (x.date < y.date ? -1 : 1));
    // Older charges in one category, the latest in another: the latest wins.
    for (const t of sorted.slice(0, 2)) {
      await db.update(transactions).set({ categoryId: housing }).where(eq(transactions.id, t.id));
    }
    await db.update(transactions).set({ categoryId: leisure }).where(eq(transactions.id, sorted[2].id));
    expect((await listRecurring(db, user.id))[0].categoryId).toBe(leisure);
  });

  it("never picks up another user's category", async () => {
    const a = await setup();
    const b = await setup();
    await seed(a.user.id, a.account.id, orange);
    await refreshRecurring(db, a.user.id);
    const foreign = await categoryId(b.user.id, "Housing");
    await db.update(transactions).set({ categoryId: foreign }).where(eq(transactions.userId, a.user.id));
    expect((await listRecurring(db, a.user.id))[0].categoryId).toBeNull();
  });
});
