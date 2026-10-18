// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "./client";
import { accounts, users } from "./schema";
import { createTestUser, resetDb } from "./test-utils";

/** Migration 0024 runs on an empty test DB, so re-run it on seeded rows. */
const migration = readFileSync(join(__dirname, "migrations/0024_localized_default_account.sql"), "utf8");

async function names(userId: string) {
  const rows = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.userId, userId));
  return rows.map((r) => r.name).sort();
}

describe("migration 0024 (localized default account)", () => {
  beforeEach(resetDb);

  it("renames the default account of French users only", async () => {
    const [fr, en, unset] = [await createTestUser(), await createTestUser(), await createTestUser()];
    await db.update(users).set({ locale: "fr" }).where(eq(users.id, fr.id));
    await db.update(users).set({ locale: "en" }).where(eq(users.id, en.id));
    for (const u of [fr, en, unset]) await db.insert(accounts).values({ userId: u.id, name: "Main account" });
    await db.insert(accounts).values({ userId: fr.id, name: "Joint" });

    await db.execute(sql.raw(migration));

    expect(await names(fr.id)).toEqual(["Compte principal", "Joint"]);
    expect(await names(en.id)).toEqual(["Main account"]);
    expect(await names(unset.id)).toEqual(["Main account"]);
  });

  it("leaves it when the French name is already taken", async () => {
    const fr = await createTestUser();
    await db.update(users).set({ locale: "fr" }).where(eq(users.id, fr.id));
    await db.insert(accounts).values([
      { userId: fr.id, name: "Main account" },
      { userId: fr.id, name: "Compte principal" },
    ]);
    await db.execute(sql.raw(migration));
    expect(await names(fr.id)).toEqual(["Compte principal", "Main account"]);
  });
});
