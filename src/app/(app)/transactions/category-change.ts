"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { useToast } from "@/components/toast";
import type { TransactionListItem } from "@/db/queries/transactions";
import type { SerialQueue } from "@/lib/optimistic/queue";

import { restoreCategoryAction } from "./undo-actions";
import type { CategoryRestore } from "./sheet-types";

/**
 * The "Moved to X · Undo" toast shared by the sheet, the swipe picker and the review card.
 * `before` is the row as it was: Undo puts back its category, source and review state.
 */
export function useCategoryChangeToast() {
  const toast = useToast();
  const t = useTranslations("transactions");

  return useCallback(
    (
      before: Pick<TransactionListItem, "id" | "category" | "categorySource" | "reviewed">,
      message: string,
      onRestored: (restore: CategoryRestore) => void,
      /** The screen's save queue: an Undo tapped while the save is in flight reaches the server after it. */
      queue?: SerialQueue,
    ) => {
      const restore = () =>
        restoreCategoryAction({
          transactionId: before.id,
          categoryId: before.category?.id ?? null,
          categorySource: before.categorySource,
          reviewed: before.reviewed,
        });
      toast.show({
        message,
        undo: {
          onUndo: async () => {
            try {
              const result = await (queue ? queue(restore) : restore());
              if (result.status === "error") {
                toast.show({ message: t("errors.undoFailed"), variant: "error" });
                return;
              }
              onRestored({ id: before.id, category: result.category, categorySource: result.categorySource, reviewed: before.reviewed });
            } catch {
              toast.show({ message: navigator.onLine === false ? t("errors.offline") : t("errors.undoFailed"), variant: "error" });
            }
          },
        },
      });
    },
    [toast, t],
  );
}

/** "Moved to Groceries" / "Moved to Uncategorized". */
export function useMovedMessage() {
  const t = useTranslations("transactions.list");
  const tGlossary = useTranslations("common.glossary");
  return useCallback(
    (category: { name: string } | null) => t("moved", { category: category?.name ?? tGlossary("uncategorized") }),
    [t, tGlossary],
  );
}

/**
 * The error toast for an instant category change the server refused or never received:
 * "Couldn't move it to X" (or the offline wording) with Try again.
 */
export function useMoveFailedToast() {
  const toast = useToast();
  const t = useTranslations("transactions.errors");
  const tToast = useTranslations("common.toast");
  return useCallback(
    (categoryName: string, retry: () => void) => {
      toast.show({
        message: navigator.onLine === false ? t("offline") : t("moveFailed", { category: categoryName }),
        variant: "error",
        action: { label: tToast("retry"), onAction: retry },
      });
    },
    [toast, t, tToast],
  );
}
