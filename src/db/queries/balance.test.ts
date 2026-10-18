// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { imports, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { createAccount, listAccounts } from "./accounts";
import { clearAccountBalance, getAccountBalances, setAccountBalance, setAccountInSafeToSpend } from "./balance";
import { undoImport } from "./imports";
import { provisionUserDefaults } from "./provision";

let hashCounter = 0;

async function seed(
  userId: string,
  accountId: string,
  rows: { date: string; amountCents: number }[],
): Promise<string> {
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
      labelRaw: "L",
      labelNormalized: "L",
      labelDisplay: "L",
      dedupeHash: `bal${hashCounter++}`,
      occurrenceIndex: 0,
    })),
  );
  return imp.id;
}

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [account] = await listAccounts(user.id);
  return { user, account };
}

const SETTINGS = { startingBalanceCents: 100000, startingBalanceDate: "2026-09-01", thresholdCents: 5000 };

describe("getAccountBalances", () => {
  beforeEach(resetDb);

  it("returns null balance and asOf for an account without a starting balance", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, [{ date: "2026-09-05", amountCents: -1000 }]);
    const [row] = await getAccountBalances(db, user.id);
    expect(row).toEqual({
      id: account.id,
      name: account.name,
      startingBalanceCents: null,
      startingBalanceDate: null,
      thresholdCents: 0,
      inSafeToSpend: true,
      balanceCents: null,
      asOf: null,
      source: null,
      bankName: null,
      fetchedAt: null,
      connected: false,
    });
  });

  it("ignores rows before the start date and counts rows on it", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, [
      { date: "2026-08-31", amountCents: -99999 },
      { date: "2026-09-01", amountCents: -85000 },
      { date: "2026-09-10", amountCents: 250000 },
    ]);
    await setAccountBalance(db, user.id, account.id, SETTINGS);
    const [row] = await getAccountBalances(db, user.id);
    expect(row.balanceCents).toBe(100000 - 85000 + 250000);
    expect(row.asOf).toBe("2026-09-10");
    expect(row.startingBalanceDate).toBe("2026-09-01");
    expect(row.thresholdCents).toBe(5000);
  });

  it("uses the day before the start date as asOf when nothing happened since", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, [{ date: "2026-08-15", amountCents: -500 }]);
    await setAccountBalance(db, user.id, account.id, SETTINGS);
    const [row] = await getAccountBalances(db, user.id);
    expect(row.balanceCents).toBe(100000);
    expect(row.asOf).toBe("2026-08-31");
  });

  it("handles a negative starting balance and month boundaries", async () => {
    const { user, account } = await setup();
    await setAccountBalance(db, user.id, account.id, {
      startingBalanceCents: -12050,
      startingBalanceDate: "2026-03-01",
      thresholdCents: 0,
    });
    const [row] = await getAccountBalances(db, user.id);
    expect(row.balanceCents).toBe(-12050);
    expect(row.asOf).toBe("2026-02-28");
  });

  it("orders accounts by creation and never counts another user's rows or accounts", async () => {
    const { user, account } = await setup();
    const second = await createAccount(db, user.id, "Livret");
    if (!second.ok) throw new Error(second.error);
    const other = await setup();
    await seed(other.user.id, other.account.id, [{ date: "2026-09-05", amountCents: -777 }]);
    await setAccountBalance(db, other.user.id, other.account.id, SETTINGS);

    const rows = await getAccountBalances(db, user.id);
    expect(rows.map((r) => r.id)).toEqual([account.id, second.account.id]);
    expect(rows.every((r) => r.balanceCents === null)).toBe(true);
  });

  it("changes when an import is undone", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, [{ date: "2026-09-03", amountCents: -85000 }]);
    const second = await seed(user.id, account.id, [{ date: "2026-09-20", amountCents: -1399 }]);
    await setAccountBalance(db, user.id, account.id, SETTINGS);
    expect((await getAccountBalances(db, user.id))[0]).toMatchObject({ balanceCents: 13601, asOf: "2026-09-20" });

    await undoImport(db, user.id, second);
    expect((await getAccountBalances(db, user.id))[0]).toMatchObject({ balanceCents: 15000, asOf: "2026-09-03" });
  });

  it("leaves the total unchanged by a transfer between two accounts", async () => {
    const { user, account } = await setup();
    const savings = await createAccount(db, user.id, "Livret");
    if (!savings.ok) throw new Error(savings.error);
    await setAccountBalance(db, user.id, account.id, SETTINGS);
    await setAccountBalance(db, user.id, savings.account.id, { ...SETTINGS, startingBalanceCents: 20000 });
    const total = async () =>
      (await getAccountBalances(db, user.id)).reduce((sum, r) => sum + (r.balanceCents ?? 0), 0);
    const before = await total();

    await seed(user.id, account.id, [{ date: "2026-09-12", amountCents: -50000 }]);
    await seed(user.id, savings.account.id, [{ date: "2026-09-12", amountCents: 50000 }]);
    expect(await total()).toBe(before);
    const rows = await getAccountBalances(db, user.id);
    expect(rows.map((r) => r.balanceCents)).toEqual([50000, 70000]);
  });
});

describe("setAccountBalance / clearAccountBalance", () => {
  beforeEach(resetDb);

  it("sets, updates and clears", async () => {
    const { user, account } = await setup();
    expect(await setAccountBalance(db, user.id, account.id, SETTINGS)).toEqual({ ok: true });
    expect(await setAccountBalance(db, user.id, account.id, { ...SETTINGS, startingBalanceCents: 0 })).toEqual({ ok: true });
    expect((await getAccountBalances(db, user.id))[0]).toMatchObject({ startingBalanceCents: 0, balanceCents: 0 });

    expect(await clearAccountBalance(db, user.id, account.id)).toEqual({ ok: true });
    expect((await getAccountBalances(db, user.id))[0]).toMatchObject({
      startingBalanceCents: null,
      startingBalanceDate: null,
      thresholdCents: 0,
      balanceCents: null,
    });
  });

  it("never touches another user's account", async () => {
    const { user } = await setup();
    const other = await setup();
    expect(await setAccountBalance(db, user.id, other.account.id, SETTINGS)).toEqual({ ok: false, error: "notFound" });
    expect(await clearAccountBalance(db, user.id, other.account.id)).toEqual({ ok: false, error: "notFound" });
    expect((await getAccountBalances(db, other.user.id))[0].startingBalanceCents).toBeNull();

    await setAccountBalance(db, other.user.id, other.account.id, SETTINGS);
    await clearAccountBalance(db, user.id, other.account.id);
    expect((await getAccountBalances(db, other.user.id))[0].startingBalanceCents).toBe(100000);
  });

  it("rejects values outside the DB bounds", async () => {
    const { user, account } = await setup();
    await expect(
      setAccountBalance(db, user.id, account.id, { ...SETTINGS, startingBalanceCents: 1_000_000_001 }),
    ).rejects.toThrow();
  });
});

describe("setAccountInSafeToSpend", () => {
  beforeEach(resetDb);

  it("round-trips the flag through getAccountBalances", async () => {
    const { user, account } = await setup();
    expect(await setAccountInSafeToSpend(db, user.id, account.id, false)).toEqual({ ok: true });
    expect((await getAccountBalances(db, user.id))[0].inSafeToSpend).toBe(false);
    expect(await setAccountInSafeToSpend(db, user.id, account.id, true)).toEqual({ ok: true });
    expect((await getAccountBalances(db, user.id))[0].inSafeToSpend).toBe(true);
  });

  it("is scoped by user_id", async () => {
    const a = await setup();
    const b = await setup();
    expect(await setAccountInSafeToSpend(db, b.user.id, a.account.id, false)).toEqual({ ok: false, error: "notFound" });
    expect((await getAccountBalances(db, a.user.id))[0].inSafeToSpend).toBe(true);
  });
});
