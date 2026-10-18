"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { networkErrorMessage } from "@/lib/offline";

import { disconnectAction } from "./actions";

/** Confirms a disconnect. Nothing but the connection goes: transactions and accounts stay. */
export function DisconnectDialog({
  connection,
  onClose,
  onDone,
}: {
  connection: { id: string; bankName: string } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("settings.bankConnection");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog
      open={connection !== null}
      onOpenChange={(next) => {
        if (pending || next) return;
        setError(null);
        onClose();
      }}
    >
      <AlertDialogContent className="theme-50f">
        {connection && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("disconnect.title", { bank: connection.bankName })}</AlertDialogTitle>
              <AlertDialogDescription>{t("disconnect.description")} {t("disconnect.balanceNote")}</AlertDialogDescription>
            </AlertDialogHeader>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>{t("cancel")}</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    try {
                      const result = await disconnectAction(connection.id);
                      if (result.status === "error") {
                        setError(result.error);
                        return;
                      }
                      onClose();
                      onDone();
                    } catch {
                      setError(networkErrorMessage(t("errors.disconnectFailed"), t("offline")));
                    }
                  })
                }
              >
                {pending ? t("disconnect.pending") : t("disconnect.confirm")}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
