"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { applyRulesAction } from "./actions";

export function ApplyRulesButton() {
  const t = useTranslations("settings.rules");
  const tToast = useTranslations("common.toast");
  const toast = useToast();
  const [pending, start] = useTransition();

  function apply() {
    start(async () => {
      const failed = (message: string) =>
        toast.show({ message, variant: "error", action: { label: tToast("retry"), onAction: apply } });
      try {
        const state = await applyRulesAction();
        if (state?.status === "ok") toast.show({ message: t("categorized", { count: state.categorized ?? 0 }) });
        else if (state?.status === "error") failed(state.error);
      } catch {
        failed(t("applyError"));
      }
    });
  }

  return (
    <Button type="button" variant="outline" pending={pending} onClick={apply} className="h-10">
      {pending ? t("applying") : t("applyNow")}
    </Button>
  );
}
