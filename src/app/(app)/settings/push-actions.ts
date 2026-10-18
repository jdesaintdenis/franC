"use server";

import { z } from "zod";

import { db } from "@/db/client";
import { deletePushSubscription, savePushSubscription } from "@/db/queries/push";
import { withActionErrors } from "@/lib/actions/safe-action";
import { requireUser } from "@/lib/auth/session";

const subscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
});

const endpointSchema = z.url({ protocol: /^https$/ }).max(2048);

export type PushActionResult = { status: "ok" } | { status: "error"; error: string };

/** Saves this device's push subscription (the JSON from `PushSubscription.toJSON()`). */
export async function savePushSubscriptionAction(value: unknown): Promise<PushActionResult> {
  const parsed = subscriptionSchema.safeParse(value);
  if (!parsed.success) return { status: "error", error: "Invalid subscription." };

  const user = await requireUser();
  return withActionErrors("Could not save the subscription.", async (): Promise<PushActionResult> => {
    const { endpoint, keys } = parsed.data;
    await savePushSubscription(db, user.id, { endpoint, p256dh: keys.p256dh, auth: keys.auth });
    return { status: "ok" };
  });
}

/** Forgets this device's subscription. */
export async function deletePushSubscriptionAction(value: unknown): Promise<PushActionResult> {
  const parsed = endpointSchema.safeParse(value);
  if (!parsed.success) return { status: "error", error: "Invalid subscription." };

  const user = await requireUser();
  return withActionErrors("Could not remove the subscription.", async (): Promise<PushActionResult> => {
    await deletePushSubscription(db, user.id, parsed.data);
    return { status: "ok" };
  });
}
