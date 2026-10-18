// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { accounts, imports, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { createAccount, listAccounts } from "./accounts";
import { getAccountFreshness, getImportReminderSettings, setAccountImportReminder, setImportReminderDays } from "./import-reminder";
import { provisionUserDefaults } from "./provision";

let hashCounter = 0;

async function seed(userId: string, accountId: string, dates: string[], uploadedAt?: Date) {
  const [imp] = await db
    .insert(imports)
    .values({ userId, accountId, filename: "x.csv", ...(uploadedAt ? { uploadedAt } : {}) })
    .returning();
  if (dates.length === 0) return;
  await db.insert(transactions).values(
    dates.map((date) => ({
      userId,
      accountId,
      importId: imp.id,
      date,
      amountCents: -100,
      labelRaw: "L",
      labelNormalized: "L",
      labelDisplay: "L",
      dedupeHash: `fresh${hashCounter++}`,
      occurrenceIndex: 0,
    })),
  );
}

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [account] = await listAccounts(user.id);
  return { user, account };
}

describe("getAccountFreshness", () => {
  beforeEach(resetDb);

  it("returns nulls for an account never imported", async () => {
    const { user, account } = await setup();
    expect(await getAccountFreshness(db, user.id)).toEqual([
      { accountId: account.id, name: account.name, reminder: true, latestDate: null, lastImportDate: null },
    ]);
  });

  it("returns the latest transaction and the Paris date of the latest import", async () => {
    const { user, account } = await setup();
    // 23:30 UTC on 27 Sept is 01:30 on 28 Sept in Paris (CEST).
    await seed(user.id, account.id, ["2026-09-01", "2026-09-12"], new Date("2026-09-27T23:30:00Z"));
    const [row] = await getAccountFreshness(db, user.id);
    expect(row.latestDate).toBe("2026-09-12");
    expect(row.lastImportDate).toBe("2026-09-28");
  });

  it("is scoped to the user and reports each account's reminder flag", async () => {
    const { user, account } = await setup();
    const other = await setup();
    await seed(other.user.id, other.account.id, ["2026-09-29"]);
    const created = await createAccount(db, user.id, "Savings");
    if (!created.ok) throw new Error("account not created");
    const savingsId = created.account.id;
    await db.update(accounts).set({ importReminder: false }).where(eq(accounts.id, savingsId));
    await seed(user.id, account.id, ["2026-09-10"]);
    const rows = await getAccountFreshness(db, user.id);
    expect(rows.map((r) => [r.name, r.latestDate, r.reminder])).toEqual([
      [account.name, "2026-09-10", true],
      ["Savings", null, false],
    ]);
  });
});

describe("getImportReminderSettings", () => {
  beforeEach(resetDb);

  it("defaults to 14 days, never notified", async () => {
    const { user } = await setup();
    expect(await getImportReminderSettings(db, user.id)).toEqual({ days: 14, notifiedOn: null });
  });
});

describe("setImportReminderDays", () => {
  beforeEach(resetDb);

  it("saves a threshold, null turns it off, and only touches that user", async () => {
    const { user } = await setup();
    const other = await setup();
    await setImportReminderDays(db, user.id, 30);
    expect((await getImportReminderSettings(db, user.id)).days).toBe(30);
    expect((await getImportReminderSettings(db, other.user.id)).days).toBe(14);
    await setImportReminderDays(db, user.id, null);
    expect((await getImportReminderSettings(db, user.id)).days).toBeNull();
  });

  it("rejects values outside 1..365 at the database", async () => {
    const { user } = await setup();
    await expect(setImportReminderDays(db, user.id, 0)).rejects.toThrow();
    await expect(setImportReminderDays(db, user.id, 366)).rejects.toThrow();
  });
});

describe("setAccountImportReminder", () => {
  beforeEach(resetDb);

  it("toggles the flag for the user's own account", async () => {
    const { user, account } = await setup();
    expect(await setAccountImportReminder(db, user.id, account.id, false)).toBe(true);
    expect((await getAccountFreshness(db, user.id))[0].reminder).toBe(false);
    expect(await setAccountImportReminder(db, user.id, account.id, true)).toBe(true);
    expect((await getAccountFreshness(db, user.id))[0].reminder).toBe(true);
  });

  it("refuses another user's account and leaves it unchanged", async () => {
    const { user } = await setup();
    const other = await setup();
    expect(await setAccountImportReminder(db, user.id, other.account.id, false)).toBe(false);
    expect((await getAccountFreshness(db, other.user.id))[0].reminder).toBe(true);
  });
});
