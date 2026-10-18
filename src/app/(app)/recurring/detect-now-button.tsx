"use client";

import { ScanSearch } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { networkErrorMessage } from "@/lib/offline";
import { cn } from "@/lib/utils";

import { detectRecurringNowAction } from "./actions";

/** An icon button in the page header; its result (or failure, with Try again) is a toast. */
export function DetectNowButton() {
  const t = useTranslations("recurring.detect");
  const tOffline = useTranslations("settings");
  const tToast = useTranslations("common.toast");
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function detect() {
    startTransition(async () => {
      const failed = (message: string) =>
        toast.show({ message, variant: "error", action: { label: tToast("retry"), onAction: detect } });
      try {
        const state = await detectRecurringNowAction();
        if (state?.status === "done") toast.show({ message: state.detected > 0 ? t("found", { count: state.detected }) : t("none") });
        else if (state?.status === "error") failed(state.error);
      } catch {
        failed(networkErrorMessage(t("failed"), tOffline("offline")));
      }
    });
  }

  return (
    <Button type="button" variant="outline" size="icon" pending={pending} onClick={detect} aria-label={t("button")} title={t("button")} className="size-11 rounded-full">
      <ScanSearch aria-hidden="true" className={cn("size-5", pending && "animate-pulse")} />
    </Button>
  );
}
