// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { accounts, imports, recurring, recurringPriceAlerts, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { listAccounts } from "./accounts";
import { undoImport } from "./imports";
import { provisionUserDefaults } from "./provision";
import { listRecurring, markRecurringStillActive, refreshRecurring, setRecurringStatus } from "./recurring";

interface Row {
  date: string;
  amountCents: number;
  label: string;
}

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [account] = await listAccounts(user.id);
  return { user, account };
}

let hashCounter = 0;

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
      labelDisplay: r.label,
      dedupeHash: `ended${hashCounter++}`,
      occurrenceIndex: 0,
    })),
  );
  return imp.id;
}

const netflix: Row[] = [
  { date: "2025-07-05", amountCents: -1399, label: "CB NETFLIX.COM" },
  { date: "2025-08-05", amountCents: -1399, label: "CB NETFLIX.COM" },
  { date: "2025-09-05", amountCents: -1399, label: "CB NETFLIX.COM" },
];
/** Moves the account's latest date to 20 Nov: Netflix then missed 5 Oct and 5 Nov. */
const groceries: Row[] = [{ date: "2025-11-20", amountCents: -4500, label: "CB CARREFOUR" }];

async function confirmedNetflix() {
  const ctx = await setup();
  await seed(ctx.user.id, ctx.account.id, netflix);
  await refreshRecurring(db, ctx.user.id);
  const [item] = await db.select().from(recurring).where(eq(recurring.userId, ctx.user.id));
  await setRecurringStatus(db, ctx.user.id, item.id, "confirmed");
  return { ...ctx, item };
}

const linkedCount = async (userId: string, recurringId: string) =>
  (
    await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.recurringId, recurringId)))
  ).length;

describe("listRecurring: yearly cost and Cancelled?", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns the yearly cost and no flag while charges keep coming", async () => {
    const { user } = await confirmedNetflix();
    const [item] = await listRecurring(db, user.id);
    expect(item).toMatchObject({ yearlyCents: -1399 * 12, accountLatestDate: "2025-09-05", possiblyCancelled: false });
  });

  it("flags a confirmed item once two charges are missed on its account", async () => {
    const { user, account } = await confirmedNetflix();
    await seed(user.id, account.id, groceries);
    const [item] = await listRecurring(db, user.id);
    expect(item).toMatchObject({ accountLatestDate: "2025-11-20", possiblyCancelled: true });
  });

  it("measures against the item's own account, not another one", async () => {
    const { user, account } = await confirmedNetflix();
    const [savings] = await db
      .insert(accounts)
      .values({ userId: user.id, name: "Savings" })
      .returning();
    await seed(user.id, savings.id, groceries);
    const [item] = await listRecurring(db, user.id, { accountId: account.id });
    expect(item.possiblyCancelled).toBe(false);
  });

  it("hides the flag after 'Still active' until another charge is missed", async () => {
    const { user, account, item } = await confirmedNetflix();
    await seed(user.id, account.id, groceries);
    expect(await markRecurringStillActive(db, user.id, item.id)).not.toBeNull();
    expect((await listRecurring(db, user.id))[0].possiblyCancelled).toBe(false);

    await seed(user.id, account.id, [{ date: "2025-12-10", amountCents: -800, label: "CB BAKERY" }]);
    expect((await listRecurring(db, user.id))[0].possiblyCancelled).toBe(true);
  });

  it("only answers 'Still active' for the user's own confirmed items", async () => {
    const { item } = await confirmedNetflix();
    const other = await setup();
    expect(await markRecurringStillActive(db, other.user.id, item.id)).toBeNull();
  });
});

describe("ended items", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("leave the default list but show with includeEnded, after the others", async () => {
    const { user, account, item } = await confirmedNetflix();
    await seed(user.id, account.id, [
      { date: "2025-07-28", amountCents: 250000, label: "VIR SEPA ACME PAYROLL" },
      { date: "2025-08-28", amountCents: 250000, label: "VIR SEPA ACME PAYROLL" },
      { date: "2025-09-28", amountCents: 250000, label: "VIR SEPA ACME PAYROLL" },
    ]);
    await refreshRecurring(db, user.id);
    const ended = await setRecurringStatus(db, user.id, item.id, "ended", "2025-10-01");
    expect(ended).toMatchObject({ status: "ended", endedAt: "2025-10-01" });

    expect((await listRecurring(db, user.id)).map((i) => i.id)).not.toContain(item.id);
    const all = await listRecurring(db, user.id, { includeEnded: true });
    expect(all.at(-1)).toMatchObject({ id: item.id, status: "ended" });
  });

  it("stay ended through a refresh, keep their links, and are never re-detected", async () => {
    const { user, item } = await confirmedNetflix();
    await setRecurringStatus(db, user.id, item.id, "ended", "2025-10-01");
    const result = await refreshRecurring(db, user.id);
    expect(result.detected).toBe(0);

    const rows = await db.select().from(recurring).where(eq(recurring.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: item.id, status: "ended", endedAt: "2025-10-01" });
    expect(await linkedCount(user.id, item.id)).toBe(3);
  });

  it("come back as confirmed when a newer charge arrives", async () => {
    const { user, account, item } = await confirmedNetflix();
    await setRecurringStatus(db, user.id, item.id, "ended", "2025-10-01");
    await seed(user.id, account.id, [{ date: "2025-10-05", amountCents: -1399, label: "CB NETFLIX.COM" }]);
    await refreshRecurring(db, user.id);

    const [row] = await db.select().from(recurring).where(eq(recurring.id, item.id));
    expect(row).toMatchObject({ status: "confirmed", endedAt: null, lastSeenDate: "2025-10-05" });
    expect(await linkedCount(user.id, item.id)).toBe(4);
  });

  it("are deleted when their transactions are gone", async () => {
    const ctx = await setup();
    const imp = await seed(ctx.user.id, ctx.account.id, netflix);
    await refreshRecurring(db, ctx.user.id);
    const [item] = await db.select().from(recurring).where(eq(recurring.userId, ctx.user.id));
    await setRecurringStatus(db, ctx.user.id, item.id, "ended", "2025-10-01");
    await seed(ctx.user.id, ctx.account.id, groceries);
    await undoImport(db, ctx.user.id, imp);
    await refreshRecurring(db, ctx.user.id);

    expect(await db.select().from(recurring).where(eq(recurring.userId, ctx.user.id))).toEqual([]);
  });

  it("resume as confirmed without the Cancelled? flag coming straight back", async () => {
    const { user, account, item } = await confirmedNetflix();
    await seed(user.id, account.id, groceries);
    await setRecurringStatus(db, user.id, item.id, "ended", "2025-11-21");
    const resumed = await setRecurringStatus(db, user.id, item.id, "confirmed");
    expect(resumed).toMatchObject({ status: "confirmed", endedAt: null, stillActiveAt: "2025-11-20" });
    expect((await listRecurring(db, user.id))[0].possiblyCancelled).toBe(false);
  });

  it("lose their open price alert when ended", async () => {
    const { user, item } = await confirmedNetflix();
    const [tx] = await db.select().from(transactions).where(eq(transactions.recurringId, item.id)).limit(1);
    await db.insert(recurringPriceAlerts).values({
      userId: user.id,
      recurringId: item.id,
      transactionId: tx.id,
      oldAmountCents: -1199,
      newAmountCents: -1399,
      chargedOn: tx.date,
    });
    await setRecurringStatus(db, user.id, item.id, "ended", "2025-10-01");
    expect(await db.select().from(recurringPriceAlerts).where(eq(recurringPriceAlerts.recurringId, item.id))).toEqual([]);
  });

  it("can't be ended by another user", async () => {
    const { item } = await confirmedNetflix();
    const other = await setup();
    expect(await setRecurringStatus(db, other.user.id, item.id, "ended", "2025-10-01")).toBeNull();
    const [row] = await db.select().from(recurring).where(eq(recurring.id, item.id));
    expect(row.status).toBe("confirmed");
  });
});
