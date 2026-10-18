"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { networkErrorMessage } from "@/lib/offline";

import { forgetBankMappingAction } from "./actions";

export function ForgetMappingButton({ mappingId, name }: { mappingId: string; name: string }) {
  const t = useTranslations("settings.bankCategories");
  const tOffline = useTranslations("settings");
  const [open, setOpen] = useState(false);
  const tToast = useTranslations("common.toast");
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  // The dialog closes either way: a failure is a toast (outside the dialog) with Try again.
  function forget() {
    startTransition(async () => {
      const failed = (message: string) => {
        setOpen(false);
        toast.show({ message, variant: "error", action: { label: tToast("retry"), onAction: forget } });
      };
      try {
        const result = await forgetBankMappingAction(mappingId);
        if (result.status === "error") failed(result.error);
        else setOpen(false);
      } catch {
        failed(networkErrorMessage(t("forget.error"), tOffline("offline")));
      }
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="h-11">
          {t.rich("forget.trigger", { name, sr: (chunks) => <span className="sr-only">{chunks}</span> })}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="theme-50f">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("forget.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t.rich("forget.description", {
              name,
              strong: (chunks) => <strong className="break-all">{chunks}</strong>,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("forget.cancel")}</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => forget()}
          >
            {pending ? t("forget.pending") : t("forget.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
