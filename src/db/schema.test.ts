// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "./client";
import { accounts, imports, transactions } from "./schema";
import { createTestUser, resetDb } from "./test-utils";

describe("transactions dedupe constraint", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects a duplicate (account_id, dedupe_hash, occurrence_index)", async () => {
    const user = await createTestUser();
    const [account] = await db
      .insert(accounts)
      .values({ userId: user.id, name: "Checking" })
      .returning();
    const [imp] = await db
      .insert(imports)
      .values({ userId: user.id, accountId: account.id, filename: "a.csv" })
      .returning();

    const base = {
      userId: user.id,
      accountId: account.id,
      importId: imp.id,
      date: "2026-01-15",
      amountCents: -1_234,
      dedupeHash: "hash-a",
    };

    await db.insert(transactions).values({ ...base, occurrenceIndex: 0 });

    await expect(
      db.insert(transactions).values({ ...base, occurrenceIndex: 0 }),
    ).rejects.toThrow();
  });

  it("allows the same hash with a different occurrence_index", async () => {
    const user = await createTestUser();
    const [account] = await db
      .insert(accounts)
      .values({ userId: user.id, name: "Checking" })
      .returning();
    const [imp] = await db
      .insert(imports)
      .values({ userId: user.id, accountId: account.id, filename: "a.csv" })
      .returning();

    const base = {
      userId: user.id,
      accountId: account.id,
      importId: imp.id,
      date: "2026-01-15",
      amountCents: -1_234,
      dedupeHash: "hash-b",
    };

    await db.insert(transactions).values({ ...base, occurrenceIndex: 0 });

    await expect(
      db.insert(transactions).values({ ...base, occurrenceIndex: 1 }),
    ).resolves.not.toThrow();
  });

  it("allows the same hash and occurrence_index in a different account", async () => {
    const user = await createTestUser();
    const [accountA] = await db
      .insert(accounts)
      .values({ userId: user.id, name: "Checking" })
      .returning();
    const [accountB] = await db
      .insert(accounts)
      .values({ userId: user.id, name: "Savings" })
      .returning();
    const [impA] = await db
      .insert(imports)
      .values({ userId: user.id, accountId: accountA.id, filename: "a.csv" })
      .returning();
    const [impB] = await db
      .insert(imports)
      .values({ userId: user.id, accountId: accountB.id, filename: "b.csv" })
      .returning();

    await db.insert(transactions).values({
      userId: user.id,
      accountId: accountA.id,
      importId: impA.id,
      date: "2026-01-15",
      amountCents: -1_234,
      dedupeHash: "hash-c",
      occurrenceIndex: 0,
    });

    await expect(
      db.insert(transactions).values({
        userId: user.id,
        accountId: accountB.id,
        importId: impB.id,
        date: "2026-01-15",
        amountCents: -1_234,
        dedupeHash: "hash-c",
        occurrenceIndex: 0,
      }),
    ).resolves.not.toThrow();
  });
});
