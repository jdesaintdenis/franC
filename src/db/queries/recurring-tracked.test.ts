// @vitest-environment node
import { and, asc, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { imports, recurring, recurringPriceAlerts, transactions, transfers } from "../schema";
import { createTestUser, resetDb, seedCategories } from "../test-utils";
import { listAccounts } from "./accounts";
import { undoImport } from "./imports";
import { provisionUserDefaults } from "./provision";
import { refreshRecurring, trackRecurring, untrackRecurring } from "./recurring";

interface Row {
  date: string;
  amountCents: number;
  label: string;
}

const LABEL = "VIR SEPA ATELIER LUMEN PAIE";

let hashCounter = 0;

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  await seedCategories(user.id);
  const [account] = await listAccounts(user.id);
  return { user, account };
}

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
      dedupeHash: `t${hashCounter++}`,
      occurrenceIndex: 0,
    })),
  );
  return imp.id;
}

const salary = (amounts: number[], firstMonth = 1): Row[] =>
  amounts.map((amountCents, i) => ({
    date: `2026-${String(firstMonth + i).padStart(2, "0")}-01`,
    amountCents,
    label: LABEL,
  }));

const newest = async (userId: string) =>
  (
    await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(asc(transactions.date))
  ).at(-1)!.id;

const items = (userId: string) => db.select().from(recurring).where(eq(recurring.userId, userId));
const linked = async (userId: string, id: string) =>
  (await db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.recurringId, id)))).length;

describe("tracked regular payments", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("tracks a varying salary that detection misses", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, salary([240_000, 330_000, 285_000]));
    await refreshRecurring(db, user.id);
    expect(await items(user.id)).toHaveLength(0);

    const result = await trackRecurring(db, user.id, await newest(user.id));
    expect(result?.previous).toBeNull();
    const [item] = await items(user.id);
    expect(item).toMatchObject({ status: "confirmed", source: "manual", typicalAmountCents: 285_000, interval: "monthly" });
    expect(await linked(user.id, item.id)).toBe(3);
  });

  it("keeps the item through refreshes and follows new payments", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, salary([240_000, 330_000, 285_000]));
    await trackRecurring(db, user.id, await newest(user.id));
    await refreshRecurring(db, user.id);
    expect((await items(user.id))[0].typicalAmountCents).toBe(285_000);

    await seed(user.id, account.id, [{ date: "2026-04-01", amountCents: 500_000, label: LABEL }]);
    await refreshRecurring(db, user.id);
    const [item] = await items(user.id);
    // sorted 2400, 2850, 3300, 5000 -> lower middle 2850
    expect(item).toMatchObject({ typicalAmountCents: 285_000, lastSeenDate: "2026-04-01", nextExpectedDate: "2026-05-01" });
    expect(await linked(user.id, item.id)).toBe(4);
  });

  it("only looks at the newest 6 payments", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, [{ date: "2025-06-01", amountCents: 999_999, label: LABEL }, ...salary([200_000, 210_000, 220_000, 230_000, 240_000, 250_000], 7).map((r, i) => ({ ...r, date: `${i < 6 ? "2025" : "2026"}-${String(7 + i).padStart(2, "0")}-01` }))]);
    await trackRecurring(db, user.id, await newest(user.id));
    // last 6: 2000..2500 -> lower middle 2200
    expect((await items(user.id))[0].typicalAmountCents).toBe(220_000);
  });

  it("converts a detected item in place, never alerts and keeps status through an outlier", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, salary([250_000, 250_000, 250_000]));
    await refreshRecurring(db, user.id);
    const [before] = await items(user.id);
    expect(before.status).toBe("detected");

    const result = await trackRecurring(db, user.id, await newest(user.id));
    expect(result?.previous?.status).toBe("detected");
    expect(result?.id).toBe(before.id);

    await seed(user.id, account.id, [{ date: "2026-04-01", amountCents: 400_000, label: LABEL }]);
    await refreshRecurring(db, user.id);
    const [after] = await items(user.id);
    expect(after).toMatchObject({ id: before.id, status: "confirmed", source: "manual" });
    expect(await db.select().from(recurringPriceAlerts).where(eq(recurringPriceAlerts.userId, user.id))).toHaveLength(0);
  });

  it("brings a dismissed item back, and Undo restores it", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, salary([250_000, 250_000, 250_000]));
    await refreshRecurring(db, user.id);
    await db.update(recurring).set({ status: "dismissed" }).where(eq(recurring.userId, user.id));
    await db.update(transactions).set({ recurringId: null }).where(eq(transactions.userId, user.id));

    const result = await trackRecurring(db, user.id, await newest(user.id));
    expect(result?.previous?.status).toBe("dismissed");
    expect((await items(user.id))[0]).toMatchObject({ status: "confirmed", source: "manual" });

    expect(await untrackRecurring(db, user.id, result!.id, result!.previous)).toBe(true);
    const [item] = await items(user.id);
    expect(item).toMatchObject({ status: "dismissed", source: "detected" });
    expect(await linked(user.id, item.id)).toBe(0);
  });

  it("stop tracking: gone when detection can't find it, kept as detected when it can", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, salary([240_000, 330_000, 285_000]));
    const varying = await trackRecurring(db, user.id, await newest(user.id));
    expect(await untrackRecurring(db, user.id, varying!.id, null)).toBe(true);
    expect(await items(user.id)).toHaveLength(0);

    await resetDb();
    const second = await setup();
    await seed(second.user.id, second.account.id, salary([250_000, 250_000, 250_000]));
    const stable = await trackRecurring(db, second.user.id, await newest(second.user.id));
    await untrackRecurring(db, second.user.id, stable!.id, null);
    expect((await items(second.user.id))[0]).toMatchObject({ status: "detected", source: "detected" });
  });

  it("is deleted once none of its payments are left", async () => {
    const { user, account } = await setup();
    const importId = await seed(user.id, account.id, salary([240_000, 330_000, 285_000]));
    await trackRecurring(db, user.id, await newest(user.id));
    await undoImport(db, user.id, importId);
    await refreshRecurring(db, user.id);
    expect(await items(user.id)).toHaveLength(0);
  });

  it("refuses ignored rows, transfer legs and other users' rows", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, salary([240_000, 330_000, 285_000]));
    const ids = (await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.userId, user.id)).orderBy(asc(transactions.date))).map((r) => r.id);

    await db.update(transactions).set({ ignoredAt: new Date() }).where(eq(transactions.id, ids[2]));
    expect(await trackRecurring(db, user.id, ids[2])).toBeNull();
    await db.update(transactions).set({ ignoredAt: null }).where(and(eq(transactions.id, ids[2]), isNull(transactions.recurringId)));

    await db.insert(transfers).values({ userId: user.id, outTransactionId: ids[0], inTransactionId: ids[1], status: "confirmed" });
    expect(await trackRecurring(db, user.id, ids[1])).toBeNull();

    const other = await createTestUser();
    expect(await trackRecurring(db, other.id, ids[2])).toBeNull();
    expect(await untrackRecurring(db, other.id, randomUuid(), null)).toBe(false);
  });
});

function randomUuid() {
  return crypto.randomUUID();
}
