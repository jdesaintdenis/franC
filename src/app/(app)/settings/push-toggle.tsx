"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { deletePushSubscriptionAction, savePushSubscriptionAction } from "./push-actions";

type State = "checking" | "unsupported" | "ios-install" | "denied" | "off" | "on";

/** The VAPID public key is URL-safe base64; PushManager wants raw bytes. */
function keyToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64Url.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

async function detect(): Promise<State> {
  if (isIos() && !isStandalone()) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  // No service worker is registered in dev, and `ready` would then wait forever.
  if (!(await navigator.serviceWorker.getRegistration())) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription()) ? "on" : "off";
}

/** Optional push notification for the import reminder, per device. `publicKey` is the server's VAPID public key. */
export function PushToggle({ publicKey }: { publicKey: string }) {
  const t = useTranslations("settings.importReminder.push");
  const [state, setState] = useState<State>("checking");
  const tToast = useTranslations("common.toast");
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    detect()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState("unsupported");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A failure is a toast with Try again.
  function failed(retry: () => void) {
    toast.show({ message: t("error"), variant: "error", action: { label: tToast("retry"), onAction: retry } });
  }

  function enable() {
    startTransition(async () => {
      try {
        if ((await Notification.requestPermission()) !== "granted") {
          setState(Notification.permission === "denied" ? "denied" : "off");
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
        const result = await savePushSubscriptionAction(subscription.toJSON());
        if (result.status === "error") {
          await subscription.unsubscribe();
          failed(enable);
          return;
        }
        setState("on");
      } catch {
        failed(enable);
      }
    });
  }

  function disable() {
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const result = await deletePushSubscriptionAction(subscription.endpoint);
          if (result.status === "error") {
            failed(disable);
            return;
          }
          await subscription.unsubscribe();
        }
        setState("off");
      } catch {
        failed(disable);
      }
    });
  }

  if (state === "checking") return null;
  if (state === "unsupported") return <p className="text-muted-foreground text-sm">{t("unsupported")}</p>;
  if (state === "ios-install") return <p className="text-muted-foreground text-sm">{t("iosInstall")}</p>;
  if (state === "denied") return <p className="text-muted-foreground text-sm">{t("denied")}</p>;

  return (
    <div className="flex flex-col items-start gap-2">
      {state === "on" ? (
        <>
          <p className="text-sm">{t("enabled")}</p>
          <Button type="button" variant="outline" onClick={disable} disabled={pending}>
            {pending ? t("disabling") : t("disable")}
          </Button>
        </>
      ) : (
        <>
          <Button type="button" variant="outline" onClick={enable} pending={pending}>
            {pending ? t("enabling") : t("enable")}
          </Button>
          <p className="text-muted-foreground text-sm">{t("hint")}</p>
        </>
      )}
    </div>
  );
}
