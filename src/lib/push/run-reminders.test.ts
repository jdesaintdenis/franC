// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { listPushSubscriptions, savePushSubscription } from "@/db/queries/push";
import { accounts, imports, transactions, users } from "@/db/schema";
import { createTestUser, resetDb } from "@/db/test-utils";
import { eq } from "drizzle-orm";

import type { ReminderPayload } from "./payload";
import { runImportReminders, type SendPush } from "./run-reminders";

const TODAY = "2026-09-30";

async function userWithStaleAccount(lastTransaction = "2026-09-01") {
  const user = await createTestUser();
  const [account] = await db.insert(accounts).values({ userId: user.id, name: "Main" }).returning();
  const [imp] = await db
    .insert(imports)
    // The import itself happened long ago too, so the account is stale.
    .values({
      userId: user.id,
      accountId: account.id,
      filename: "x.csv",
      rowsTotal: 1,
      rowsError: 0,
      uploadedAt: new Date(`${lastTransaction}T10:00:00Z`),
    })
    .returning();
  await db.insert(transactions).values({
    userId: user.id,
    accountId: account.id,
    importId: imp.id,
    date: lastTransaction,
    amountCents: -100,
    labelRaw: "L",
    labelNormalized: "L",
    labelDisplay: "L",
    dedupeHash: `h${user.id}`,
    occurrenceIndex: 0,
  });
  return user;
}

function fakeSender(results: Record<string, number | "ok">) {
  const calls: { endpoint: string; payload: ReminderPayload }[] = [];
  const send: SendPush = async (subscription, payload) => {
    calls.push({ endpoint: subscription.endpoint, payload });
    const result = results[subscription.endpoint] ?? "ok";
    return result === "ok" ? { ok: true } : { ok: false, statusCode: result };
  };
  return { send, calls };
}

const sub = (endpoint: string) => ({ endpoint, p256dh: "p", auth: "a" });

describe("runImportReminders", () => {
  beforeEach(resetDb);

  it("notifies a stale user once, then waits a week", async () => {
    const user = await userWithStaleAccount();
    await savePushSubscription(db, user.id, sub("https://push.example/1"));
    const { send, calls } = fakeSender({});

    expect(await runImportReminders({ database: db, send, today: TODAY })).toEqual({ users: 1, sent: 1, failed: 0, removed: 0 });
    expect(calls[0].payload).toMatchObject({ url: "/import", title: "Time to import" });
    expect(JSON.stringify(calls[0].payload)).not.toContain("Main");
    const [row] = await db.select({ on: users.importReminderNotifiedOn }).from(users).where(eq(users.id, user.id));
    expect(row.on).toBe(TODAY);

    expect((await runImportReminders({ database: db, send, today: "2026-10-03" })).users).toBe(0);
    expect((await runImportReminders({ database: db, send, today: "2026-10-07" })).sent).toBe(1);
  });

  it("removes expired subscriptions and does not mark notified when nothing was delivered", async () => {
    const user = await userWithStaleAccount();
    await savePushSubscription(db, user.id, sub("https://push.example/gone"));
    await savePushSubscription(db, user.id, sub("https://push.example/flaky"));
    const { send } = fakeSender({ "https://push.example/gone": 410, "https://push.example/flaky": 500 });

    expect(await runImportReminders({ database: db, send, today: TODAY })).toEqual({ users: 1, sent: 0, failed: 1, removed: 1 });
    expect((await listPushSubscriptions(db, user.id)).map((s) => s.endpoint)).toEqual(["https://push.example/flaky"]);
    const [row] = await db.select({ on: users.importReminderNotifiedOn }).from(users).where(eq(users.id, user.id));
    expect(row.on).toBeNull();
  });

  it("skips users whose data is fresh", async () => {
    const user = await userWithStaleAccount("2026-09-29");
    await savePushSubscription(db, user.id, sub("https://push.example/1"));
    const { send, calls } = fakeSender({});
    expect((await runImportReminders({ database: db, send, today: TODAY })).users).toBe(0);
    expect(calls).toEqual([]);
  });
});
