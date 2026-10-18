// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "./client";
import { users } from "./schema";
import { resetDb } from "./test-utils";

describe("db connection", () => {
  beforeAll(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
  });

  it("round-trips a row through Postgres via Drizzle", async () => {
    const [inserted] = await db
      .insert(users)
      .values({ id: "client-test-user", email: "client-test@example.test", name: "Client Test" })
      .returning();
    expect(inserted.id).toBe("client-test-user");

    const rows = await db.select().from(users).where(eq(users.id, "client-test-user"));
    expect(rows.some((row) => row.id === inserted.id)).toBe(true);
  });
});
