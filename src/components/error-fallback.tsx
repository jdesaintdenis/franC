"use client";

import { useTranslations } from "next-intl";

/**
 * Shared body of the route error boundaries. It never renders `error.message`:
 * server errors can carry query parameters (labels, amounts), so only the
 * digest, which matches the redacted server log line, is shown.
 */
export function ErrorFallback({
  error,
  retry,
  fallbackMessage,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  fallbackMessage?: string;
}) {
  const t = useTranslations("auth.shell.error");
  const tActions = useTranslations("common.actions");
  // Friendlier message than a generic failure when the device has no network.
  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p role="alert" className="text-muted-foreground max-w-sm">
          {offline ? t("offline") : (fallbackMessage ?? t("pageFallback"))}
        </p>
        <button
          type="button"
          onClick={() => retry()}
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 inline-flex h-10 items-center rounded-md px-4 text-sm font-medium"
        >
          {tActions("retry")}
        </button>
        {error.digest && (
          <p className="text-muted-foreground text-xs">
            {t("reference", { digest: error.digest })}
          </p>
        )}
      </main>
    </div>
  );
}
