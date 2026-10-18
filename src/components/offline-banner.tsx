"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function OfflineBanner() {
  const t = useTranslations("auth.shell");
  // Server snapshot is "online" so SSR markup never includes the banner.
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );

  if (online) return null;

  return (
    <div
      role="status"
      className="bg-destructive text-white dark:bg-red-800 sticky top-0 z-50 px-4 py-2 text-center text-sm font-medium"
    >
      {t("banner")}
    </div>
  );
}
