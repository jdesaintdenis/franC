"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";

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

import { deleteAccountAction } from "./actions";

const strong = (chunks: ReactNode) => <strong className="break-all">{chunks}</strong>;

/**
 * The confirmation of an account delete (choice C: no Undo, the transactions go with it).
 * Opened from the row's "⋯" menu, so it is controlled by the screen.
 */
export function DeleteAccountDialog({
  account,
  goalNames,
  onClose,
}: {
  account: { id: string; name: string; importCount: number; transactionCount: number } | null;
  /** Goals that will keep their money as goals tracked by hand; empty when none is kept in this account. */
  goalNames: string[];
  onClose: () => void;
}) {
  const t = useTranslations("settings");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog
      open={account !== null}
      onOpenChange={(next) => {
        if (pending || next) return;
        setError(null);
        onClose();
      }}
    >
      <AlertDialogContent className="theme-50f">
        {account && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("accounts.delete.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t.rich("accounts.delete.description", {
                  name: account.name,
                  imports: account.importCount,
                  transactions: account.transactionCount,
                  strong,
                })}
                {goalNames.length > 0 && <> {t.rich("accounts.delete.goalNote", { goals: goalNames.join(", "), strong })}</>}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>{t("accounts.delete.cancel")}</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    try {
                      const result = await deleteAccountAction(account.id);
                      if (result.status === "error") {
                        setError(result.error);
                        return;
                      }
                      onClose();
                    } catch {
                      setError(networkErrorMessage(t("accounts.errors.deleteFailed"), t("offline")));
                    }
                  })
                }
              >
                {pending ? t("accounts.delete.pending") : t("accounts.delete.confirm")}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
