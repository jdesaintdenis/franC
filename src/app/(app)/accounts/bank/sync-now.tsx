"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { networkErrorMessage } from "@/lib/offline";
import { cn } from "@/lib/utils";

import { syncNowAction, type SyncState } from "./sync-action";

/** Sync now for the given linked bank accounts, with the outcome in one line below. */
export function SyncNow({
  linkIds,
  variant = "default",
  className,
}: {
  linkIds: string[];
  variant?: "default" | "outline";
  className?: string;
}) {
  const t = useTranslations("settings.bankConnection.sync");
  const tConnection = useTranslations("settings.bankConnection");
  const [state, setState] = useState<SyncState | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      setState(null);
      try {
        setState(await syncNowAction(linkIds));
      } catch {
        setState({ status: "error", error: networkErrorMessage(t("errors.failed"), tConnection("offline")) });
      }
    });

  return (
    <div className="flex flex-col gap-2 self-stretch">
      <Button type="button" variant={variant} className={cn("self-start", className)} disabled={pending} onClick={run}>
        <RefreshCw aria-hidden="true" className={pending ? "motion-safe:animate-spin" : undefined} />
        {pending ? t("pending") : t("button")}
      </Button>
      <div role="status" className="text-sm" data-testid="sync-result">
        {state?.status === "ok" && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t("result", { count: state.inserted })}</span>
            {state.inserted > 0 && (
              <Link href="/review" className="text-primary font-medium underline underline-offset-2">
                {t("review")}
              </Link>
            )}
            {state.errors > 0 && <span className="text-destructive">{t("rowErrors", { count: state.errors })}</span>}
          </span>
        )}
      </div>
      {state?.status === "error" && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
    </div>
  );
}
