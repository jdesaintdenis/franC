"use client";

import { ScanSearch } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { detectRecurringNowAction } from "./actions";

/** The empty state's primary action: the same scan as the header's Detect now, with a toast result. */
export function EmptyDetectButton({ label }: { label: string }) {
  const t = useTranslations("recurring.detect");
  const tToast = useTranslations("common.toast");
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function detect() {
    startTransition(async () => {
      const state = await detectRecurringNowAction();
      if (state.status === "error") {
        toast.show({ message: state.error, variant: "error", action: { label: tToast("retry"), onAction: detect } });
        return;
      }
      toast.show({ message: state.detected > 0 ? t("found", { count: state.detected }) : t("none") });
      router.refresh();
    });
  }

  return (
    <Button type="button" className="h-11" disabled={pending} onClick={detect}>
      <ScanSearch aria-hidden="true" className="size-5" />
      {label}
    </Button>
  );
}
