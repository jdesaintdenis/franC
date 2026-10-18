import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { accounts, users } from "@/db/schema";
import { resetDb } from "@/db/test-utils";
import { eq } from "drizzle-orm";

import { auth } from "./server";

// The allowlist is read from process.env at call time (see server.ts), so
// tests can set it here, before calling the auth API, without re-importing
// the module.
describe("auth sign-up allowlist + provisioning (DB)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates the user and provisions defaults for an allowlisted email", async () => {
    process.env.ALLOWED_EMAILS = "allowed@example.com";

    await auth.api.signUpEmail({
      body: {
        email: "allowed@example.com",
        password: "a-strong-password",
        name: "Allowed User",
      },
      headers: new Headers(),
    });

    const [user] = await db.select().from(users).where(eq(users.email, "allowed@example.com"));
    expect(user).toBeDefined();

    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, user.id));
    expect(userAccounts.length).toBeGreaterThan(0);
  });

  it("rejects a non-allowlisted email and creates no user", async () => {
    process.env.ALLOWED_EMAILS = "allowed@example.com";

    await expect(
      auth.api.signUpEmail({
        body: {
          email: "not-allowed@example.com",
          password: "a-strong-password",
          name: "Not Allowed",
        },
        headers: new Headers(),
      }),
    ).rejects.toThrow();

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, "not-allowed@example.com"));
    expect(user).toBeUndefined();
  });
});
