import webpush from "web-push";

import type { VapidConfig } from "./config";
import type { SendPush } from "./run-reminders";

/** Real sender backed by the `web-push` library (VAPID signing and payload encryption). */
export function createWebPushSender(vapid: VapidConfig): SendPush {
  const options = {
    vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    TTL: 24 * 60 * 60,
  };
  return async (subscription, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
        options,
      );
      return { ok: true };
    } catch (error) {
      const statusCode = error instanceof webpush.WebPushError ? error.statusCode : null;
      return { ok: false, statusCode };
    }
  };
}
