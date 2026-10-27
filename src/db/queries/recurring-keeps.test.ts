// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { recurring } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { listAccounts } from "./accounts";
import { provisionUserDefaults } from "./provision";
import { hasKeptIncome, listRecurring, setKeepsForNextMonth } from "./recurring";

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [account] = await listAccounts(user.id);
  return { user, account };
}

async function insertItem(ctx: Awaited<ReturnType<typeof setup>>, over: Partial<typeof recurring.$inferInsert>) {
  const [item] = await db
    .insert(recurring)
    .values({
      userId: ctx.user.id,
      accountId: ctx.account.id,
      merchantKey: `KEY${Math.random()}`,
      typicalAmountCents: 241200,
      interval: "monthly",
      lastSeenDate: "2025-09-28",
      status: "confirmed",
      ...over,
    })
    .returning();
  return item;
}

const kept = async (id: string) => (await db.select().from(recurring).where(eq(recurring.id, id)))[0].keepsForNextMonth;

describe("setKeepsForNextMonth", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("is off by default, switches on and off, and shows in the list", async () => {
    const ctx = await setup();
    const item = await insertItem(ctx, {});
    expect(await kept(item.id)).toBe(false);

    expect(await setKeepsForNextMonth(db, ctx.user.id, item.id, true)).toBe(true);
    expect(await kept(item.id)).toBe(true);
    expect((await listRecurring(db, ctx.user.id)).find((i) => i.id === item.id)?.keepsForNextMonth).toBe(true);

    expect(await setKeepsForNextMonth(db, ctx.user.id, item.id, false)).toBe(true);
    expect(await kept(item.id)).toBe(false);
  });

  it("refuses a detected item and an outflow", async () => {
    const ctx = await setup();
    const detected = await insertItem(ctx, { status: "detected" });
    const bill = await insertItem(ctx, { typicalAmountCents: -999 });
    expect(await setKeepsForNextMonth(db, ctx.user.id, detected.id, true)).toBe(false);
    expect(await setKeepsForNextMonth(db, ctx.user.id, bill.id, true)).toBe(false);
    expect(await kept(detected.id)).toBe(false);
    expect(await kept(bill.id)).toBe(false);
  });

  it("can't touch another user's item", async () => {
    const ctx = await setup();
    const other = await setup();
    const item = await insertItem(ctx, {});
    expect(await setKeepsForNextMonth(db, other.user.id, item.id, true)).toBe(false);
    expect(await kept(item.id)).toBe(false);
  });
});

describe("hasKeptIncome", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("is true only once one of the user's confirmed incomes is kept", async () => {
    const ctx = await setup();
    const other = await setup();
    const item = await insertItem(ctx, {});
    await insertItem(other, { keepsForNextMonth: true });
    await insertItem(ctx, { status: "detected", keepsForNextMonth: true });
    expect(await hasKeptIncome(db, ctx.user.id)).toBe(false);
    await setKeepsForNextMonth(db, ctx.user.id, item.id, true);
    expect(await hasKeptIncome(db, ctx.user.id)).toBe(true);
  });
});
