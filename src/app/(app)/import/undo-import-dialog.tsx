"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition, type ReactNode } from "react";

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

import { undoImportAction } from "./actions";

const em = (chunks: ReactNode) => <em className="break-all">{chunks}</em>;

/** The "Undo this import?" confirmation, opened from the history menu or the result screen. */
export function UndoImportDialog({
  open,
  onOpenChange,
  importId,
  filename,
  rowsInserted,
  onUndone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  importId: string;
  filename: string;
  rowsInserted: number;
  onUndone?: () => void;
}) {
  const t = useTranslations("import.undo");
  const tErrors = useTranslations("import.errors");
  const tActions = useTranslations("common.actions");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
        setError(null);
      }}
    >
      <AlertDialogContent className="theme-50f">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {rowsInserted > 0
              ? t.rich("descriptionWithRows", { count: rowsInserted, filename, em })
              : t.rich("descriptionNoRows", { filename, em })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tActions("cancel")}</AlertDialogCancel>
          {/* A plain Button, not AlertDialogAction, so the dialog stays open while pending or on error. */}
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                try {
                  const result = await undoImportAction(importId);
                  if (result.status === "error") {
                    setError(tErrors(result.error));
                    return;
                  }
                  onOpenChange(false);
                  onUndone?.();
                } catch {
                  setError(navigator.onLine === false ? tErrors("offline") : tErrors("undoFailed"));
                }
              })
            }
          >
            {pending ? t("pending") : t("confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
