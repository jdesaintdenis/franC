// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { createTestUser, resetDb } from "../test-utils";
import { setImportReminderDays } from "./import-reminder";
import {
  deleteExpiredPushSubscription,
  deletePushSubscription,
  listPushCandidates,
  listPushSubscriptions,
  markImportReminderNotified,
  savePushSubscription,
} from "./push";

const sub = (endpoint: string) => ({ endpoint, p256dh: "p", auth: "a" });

describe("push subscriptions", () => {
  beforeEach(resetDb);

  it("upserts on endpoint and reassigns it to the current user", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    await savePushSubscription(db, a.id, sub("https://push.example/1"));
    await savePushSubscription(db, b.id, { endpoint: "https://push.example/1", p256dh: "p2", auth: "a2" });
    expect(await listPushSubscriptions(db, a.id)).toEqual([]);
    expect(await listPushSubscriptions(db, b.id)).toEqual([{ endpoint: "https://push.example/1", p256dh: "p2", auth: "a2" }]);
  });

  it("deletes only the user's own subscription", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    await savePushSubscription(db, a.id, sub("https://push.example/1"));
    expect(await deletePushSubscription(db, b.id, "https://push.example/1")).toBe(false);
    expect(await listPushSubscriptions(db, a.id)).toHaveLength(1);
    expect(await deletePushSubscription(db, a.id, "https://push.example/1")).toBe(true);
    expect(await listPushSubscriptions(db, a.id)).toEqual([]);
  });

  it("deletes an expired endpoint regardless of owner", async () => {
    const a = await createTestUser();
    await savePushSubscription(db, a.id, sub("https://push.example/1"));
    await deleteExpiredPushSubscription(db, "https://push.example/1");
    expect(await listPushSubscriptions(db, a.id)).toEqual([]);
  });

  it("lists candidates only with the reminder on and a subscription, and records the notification date", async () => {
    const on = await createTestUser();
    const off = await createTestUser();
    const noSub = await createTestUser();
    await setImportReminderDays(db, on.id, 14);
    await setImportReminderDays(db, off.id, null);
    await setImportReminderDays(db, noSub.id, 14);
    await savePushSubscription(db, on.id, sub("https://push.example/1"));
    await savePushSubscription(db, off.id, sub("https://push.example/2"));

    expect(await listPushCandidates(db)).toEqual([{ userId: on.id, locale: null, days: 14, notifiedOn: null }]);
    await markImportReminderNotified(db, on.id, "2026-09-30");
    expect((await listPushCandidates(db))[0]?.notifiedOn).toBe("2026-09-30");
  });
});
