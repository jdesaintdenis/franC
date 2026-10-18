// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { imports, recurring, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { listAccounts } from "./accounts";
import { provisionUserDefaults } from "./provision";
import {
  listRecurring,
  listRecurringHistory,
  refreshRecurring,
  restoreRecurring,
  setRecurringStatus,
  setRecurringStatuses,
} from "./recurring";

let hashCounter = 0;

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [account] = await listAccounts(user.id);
  return { user, account };
}

function monthly(label: string, amountCents: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    date: `2025-${String(i + 1).padStart(2, "0")}-05`,
    amountCents,
    label,
  }));
}

async function seed(
  userId: string,
  accountId: string,
  rows: { date: string; amountCents: number; label: string }[],
) {
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
      dedupeHash: `restore${hashCounter++}`,
      occurrenceIndex: 0,
    })),
  );
}

/** A user with Netflix and Spotify detected. */
async function withTwoItems() {
  const ctx = await setup();
  await seed(ctx.user.id, ctx.account.id, [
    ...monthly("CB NETFLIX.COM", -1399, 5),
    ...monthly("CB SPOTIFY AB", -999, 5),
  ]);
  await refreshRecurring(db, ctx.user.id);
  const items = await listRecurring(db, ctx.user.id);
  expect(items).toHaveLength(2);
  const netflix = items.find((i) => i.name.includes("NETFLIX"));
  const spotify = items.find((i) => i.name.includes("SPOTIFY"));
  if (!netflix || !spotify) throw new Error("fixture");
  return { ...ctx, netflix, spotify };
}

const linked = async (userId: string, recurringId: string) =>
  (
    await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.recurringId, recurringId)))
  ).length;

describe("restoreRecurring", () => {
  beforeEach(resetDb);

  it("keeps a dismissed item from being re-detected, then brings it back confirmed and relinked", async () => {
    const { user, netflix } = await withTwoItems();
    await setRecurringStatus(db, user.id, netflix.id, "dismissed");
    expect(await linked(user.id, netflix.id)).toBe(0);

    await refreshRecurring(db, user.id);
    const [stillDismissed] = await db.select().from(recurring).where(eq(recurring.id, netflix.id));
    expect(stillDismissed.status).toBe("dismissed");
    expect(await linked(user.id, netflix.id)).toBe(0);
    expect(await db.select().from(recurring).where(eq(recurring.userId, user.id))).toHaveLength(2);

    const restored = await restoreRecurring(db, user.id, netflix.id, "confirmed");
    expect(restored?.status).toBe("confirmed");
    await refreshRecurring(db, user.id);
    const [after] = await db.select().from(recurring).where(eq(recurring.id, netflix.id));
    expect(after.status).toBe("confirmed");
    expect(await linked(user.id, netflix.id)).toBe(5);
  });

  it("restores as detected too", async () => {
    const { user, netflix } = await withTwoItems();
    await setRecurringStatus(db, user.id, netflix.id, "dismissed");
    expect((await restoreRecurring(db, user.id, netflix.id, "detected"))?.status).toBe("detected");
  });

  it("only restores dismissed items the user owns", async () => {
    const { user, netflix, spotify } = await withTwoItems();
    const other = await setup();
    await setRecurringStatus(db, user.id, netflix.id, "dismissed");
    expect(await restoreRecurring(db, other.user.id, netflix.id, "confirmed")).toBeNull();
    expect(await restoreRecurring(db, user.id, spotify.id, "confirmed")).toBeNull();
    const [row] = await db.select().from(recurring).where(eq(recurring.id, netflix.id));
    expect(row.status).toBe("dismissed");
  });
});

describe("setRecurringStatus confirmed -> detected", () => {
  beforeEach(resetDb);

  it("undoes a confirm", async () => {
    const { user, netflix } = await withTwoItems();
    await setRecurringStatus(db, user.id, netflix.id, "confirmed");
    const row = await setRecurringStatus(db, user.id, netflix.id, "detected");
    expect(row?.status).toBe("detected");
  });
});

describe("setRecurringStatuses", () => {
  beforeEach(resetDb);

  it("applies every change in one go", async () => {
    const { user, netflix, spotify } = await withTwoItems();
    const rows = await setRecurringStatuses(db, user.id, [
      { id: netflix.id, status: "confirmed" },
      { id: spotify.id, status: "confirmed" },
    ]);
    expect(rows?.map((r) => r.status)).toEqual(["confirmed", "confirmed"]);
    const back = await setRecurringStatuses(db, user.id, [
      { id: netflix.id, status: "detected" },
      { id: spotify.id, status: "detected" },
    ]);
    expect(back?.map((r) => r.status)).toEqual(["detected", "detected"]);
  });

  it("changes nothing when one item is unknown, dismissed or not the user's", async () => {
    const { user, netflix, spotify } = await withTwoItems();
    const other = await setup();
    await setRecurringStatus(db, user.id, spotify.id, "dismissed");

    expect(
      await setRecurringStatuses(db, user.id, [
        { id: netflix.id, status: "confirmed" },
        { id: spotify.id, status: "confirmed" },
      ]),
    ).toBeNull();
    expect(
      await setRecurringStatuses(db, other.user.id, [{ id: netflix.id, status: "confirmed" }]),
    ).toBeNull();
    expect(
      await setRecurringStatuses(db, user.id, [
        { id: netflix.id, status: "confirmed" },
        { id: "00000000-0000-4000-8000-000000000000", status: "confirmed" },
      ]),
    ).toBeNull();

    const [row] = await db.select().from(recurring).where(eq(recurring.id, netflix.id));
    expect(row.status).toBe("detected");
  });
});

describe("listRecurringHistory", () => {
  beforeEach(resetDb);

  it("returns an empty map for no ids", async () => {
    const { user } = await setup();
    expect((await listRecurringHistory(db, user.id, [])).size).toBe(0);
  });

  it("returns the newest charges per item, capped by the limit", async () => {
    const { user, netflix, spotify } = await withTwoItems();
    const history = await listRecurringHistory(db, user.id, [netflix.id, spotify.id], 3);
    const n = history.get(netflix.id);
    expect(n?.map((h) => h.date)).toEqual(["2025-05-05", "2025-04-05", "2025-03-05"]);
    expect(n?.[0]).toMatchObject({ amountCents: -1399 });
    expect(history.get(spotify.id)).toHaveLength(3);
    expect((await listRecurringHistory(db, user.id, [netflix.id])).get(netflix.id)).toHaveLength(5);
  });

  it("does not return another user's charges", async () => {
    const { netflix } = await withTwoItems();
    const other = await setup();
    expect((await listRecurringHistory(db, other.user.id, [netflix.id])).size).toBe(0);
  });
});

describe("listRecurring includeDismissed", () => {
  beforeEach(resetDb);

  it("returns dismissed items last, only on request", async () => {
    const { user, netflix, spotify } = await withTwoItems();
    await setRecurringStatus(db, user.id, netflix.id, "dismissed");
    await setRecurringStatus(db, user.id, spotify.id, "ended", "2025-06-01");

    expect(await listRecurring(db, user.id)).toHaveLength(0);
    expect(await listRecurring(db, user.id, { includeEnded: true })).toHaveLength(1);
    const all = await listRecurring(db, user.id, { includeEnded: true, includeDismissed: true });
    expect(all.map((i) => i.status)).toEqual(["ended", "dismissed"]);
  });
});
