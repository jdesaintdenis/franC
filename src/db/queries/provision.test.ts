// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { accounts, categories } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { provisionUserDefaults } from "./provision";

describe("provisionUserDefaults", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates one default account and no categories", async () => {
    const user = await createTestUser();

    await provisionUserDefaults(db, user.id);

    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, user.id));
    const userCategories = await db.select().from(categories).where(eq(categories.userId, user.id));

    expect(userAccounts).toHaveLength(1);
    expect(userCategories).toHaveLength(0);
  });

  it("is idempotent when run twice", async () => {
    const user = await createTestUser();

    await provisionUserDefaults(db, user.id);
    await provisionUserDefaults(db, user.id);

    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, user.id));
    const userCategories = await db.select().from(categories).where(eq(categories.userId, user.id));

    expect(userAccounts).toHaveLength(1);
    expect(userCategories).toHaveLength(0);
  });

  it("names the account in the sign-up language", async () => {
    const [en, fr] = [await createTestUser(), await createTestUser()];
    await provisionUserDefaults(db, en.id);
    await provisionUserDefaults(db, fr.id, "fr");
    const [enAccount] = await db.select().from(accounts).where(eq(accounts.userId, en.id));
    const [frAccount] = await db.select().from(accounts).where(eq(accounts.userId, fr.id));
    expect(enAccount.name).toBe("Main account");
    expect(frAccount.name).toBe("Compte principal");
  });
});
