// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { users } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { getIncomeMonth, getUserLocale, setIncomeMonth, setUserLocale } from "./users";

describe("user locale queries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("defaults to null, saves a locale and clears it again", async () => {
    const user = await createTestUser();
    expect(await getUserLocale(user.id)).toBeNull();

    await setUserLocale(user.id, "fr");
    expect(await getUserLocale(user.id)).toBe("fr");

    await setUserLocale(user.id, "en");
    expect(await getUserLocale(user.id)).toBe("en");

    await setUserLocale(user.id, null);
    expect(await getUserLocale(user.id)).toBeNull();
  });

  it("only touches the given user's row", async () => {
    const a = await createTestUser();
    const b = await createTestUser();

    await setUserLocale(a.id, "fr");

    expect(await getUserLocale(a.id)).toBe("fr");
    expect(await getUserLocale(b.id)).toBeNull();
  });

  it("rejects unsupported locales at the database level", async () => {
    const user = await createTestUser();
    await expect(db.update(users).set({ locale: "de" })).rejects.toThrow();
    expect(await getUserLocale(user.id)).toBeNull();
  });
});

describe("income month queries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("defaults to next, saves a choice and only touches that user", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    expect(await getIncomeMonth(a.id)).toBe("next");

    await setIncomeMonth(a.id, "this");
    expect(await getIncomeMonth(a.id)).toBe("this");
    expect(await getIncomeMonth(b.id)).toBe("next");

    await setIncomeMonth(a.id, "next");
    expect(await getIncomeMonth(a.id)).toBe("next");
  });
});
