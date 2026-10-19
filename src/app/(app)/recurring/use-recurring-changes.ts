"use client";

import { useTranslations } from "next-intl";
import { useOptimistic, useRef, useTransition } from "react";

import { useToast } from "@/components/toast";
import { createSerialQueue } from "@/lib/optimistic/queue";
import { applyStatusChanges, resolvePriceAlert, setKeepsForNextMonth, type StatusChange } from "@/lib/recurring/optimistic";

import {
  acceptPriceAlertAction,
  confirmRecurringAction,
  dismissPriceAlertAction,
  dismissRecurringAction,
  endRecurringAction,
  restoreRecurringAction,
  setKeepsForNextMonthAction,
  setRecurringStatusesAction,
  stillActiveRecurringAction,
  trackRecurringAction,
  untrackRecurringAction,
  type RecurringActionState,
} from "./actions";
import type { RecurringViewItem } from "./view-item";

type Optimistic =
  | { kind: "status"; changes: StatusChange[] }
  | { kind: "alert"; id: string; accept: boolean }
  | { kind: "keeps"; id: string; value: boolean };

function reduce(items: RecurringViewItem[], action: Optimistic): RecurringViewItem[] {
  if (action.kind === "status") return applyStatusChanges(items, action.changes);
  if (action.kind === "keeps") return setKeepsForNextMonth(items, action.id, action.value);
  return resolvePriceAlert(items, action.id, action.accept);
}

interface Change {
  optimistic: Optimistic;
  call: () => Promise<RecurringActionState>;
  /** Shown if the action fails or throws. */
  failed: string;
  /** Success toast; without `undo` it is a plain confirmation. */
  done?: { message: string; undo?: () => void };
}

/**
 * Every change to a regular payment: the list updates at once (useOptimistic), a toast says
 * what happened with Undo where the change can be reversed, and a failure puts the item back
 * (the server data wins again) with an error toast. Undo runs through the same path without
 * announcing itself again.
 */
export function useRecurringChanges(items: RecurringViewItem[]) {
  const t = useTranslations("recurring");
  const toast = useToast();
  const [optimisticItems, applyOptimistic] = useOptimistic<RecurringViewItem[], Optimistic>(items, reduce);
  const [pending, startTransition] = useTransition();
  // Server calls run one after another, in click order (see createSerialQueue).
  const serialized = useRef(createSerialQueue()).current;

  function run({ optimistic, call, failed, done }: Change) {
    startTransition(async () => {
      applyOptimistic(optimistic);
      if (done) toast.show({ message: done.message, undo: done.undo && { onUndo: done.undo } });
      try {
        const result = await serialized(call);
        if (result.status === "error") toast.show({ message: result.error, variant: "error" });
      } catch {
        // Offline gets its own message: it is the likeliest reason for a thrown action.
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        toast.show({ message: offline ? t("errors.offline") : failed, variant: "error" });
      }
    });
  }

  const status = (id: string, to: StatusChange["status"]): Optimistic => ({
    kind: "status",
    changes: [{ id, status: to }],
  });

  /** Undo of a status change: no toast of its own, and a failure is reported like any other. */
  function undoStatus(item: RecurringViewItem, to: "detected" | "confirmed" | "dismissed", call: () => Promise<RecurringActionState>) {
    run({ optimistic: status(item.id, to), call, failed: t("errors.undoFailed") });
  }

  const resumeCall = (item: RecurringViewItem) => () => confirmRecurringAction(item.id);
  const detectedCall = (ids: string[]) => () =>
    setRecurringStatusesAction(ids.map((id) => ({ id, status: "detected" as const })));

  return {
    items: optimisticItems,
    pending,

    confirm(item: RecurringViewItem) {
      run({
        optimistic: status(item.id, "confirmed"),
        call: () => confirmRecurringAction(item.id),
        failed: t("errors.confirmFailed", { name: item.name }),
        done: {
          message: t("toast.confirmed", { name: item.name }),
          undo: () => undoStatus(item, "detected", detectedCall([item.id])),
        },
      });
    },

    /** The previous status is what Undo restores (detected or confirmed). */
    dismiss(item: RecurringViewItem) {
      const previous = item.status === "detected" ? "detected" : "confirmed";
      run({
        optimistic: status(item.id, "dismissed"),
        call: () => dismissRecurringAction(item.id),
        failed: t("errors.dismissFailed", { name: item.name }),
        done: {
          message: t("toast.dismissed", { name: item.name }),
          undo: () => undoStatus(item, previous, () => restoreRecurringAction(item.id, previous)),
        },
      });
    },

    end(item: RecurringViewItem) {
      run({
        optimistic: status(item.id, "ended"),
        call: () => endRecurringAction(item.id),
        failed: t("errors.endFailed", { name: item.name }),
        done: {
          message: t("toast.ended", { name: item.name }),
          // Resuming, as the Resume button does: the "Cancelled?" flag doesn't come straight back.
          undo: () => undoStatus(item, "confirmed", resumeCall(item)),
        },
      });
    },

    resume(item: RecurringViewItem) {
      run({
        optimistic: status(item.id, "confirmed"),
        call: resumeCall(item),
        failed: t("errors.resumeFailed", { name: item.name }),
        done: {
          message: t("toast.resumed", { name: item.name }),
          undo: () => run({
            optimistic: status(item.id, "ended"),
            call: () => endRecurringAction(item.id),
            failed: t("errors.undoFailed"),
          }),
        },
      });
    },

    /** Restore brings a dismissed item back as confirmed: you are saying it is a regular payment. */
    restore(item: RecurringViewItem) {
      run({
        optimistic: status(item.id, "confirmed"),
        call: () => restoreRecurringAction(item.id, "confirmed"),
        failed: t("errors.restoreFailed", { name: item.name }),
        done: {
          message: t("toast.restored", { name: item.name }),
          undo: () => undoStatus(item, "dismissed", () => dismissRecurringAction(item.id)),
        },
      });
    },

    /** Back to detection's hands; Undo tracks again from the newest payment. */
    stopTracking(item: RecurringViewItem) {
      const newest = item.history[0];
      run({
        optimistic: status(item.id, "detected"),
        call: () => untrackRecurringAction({ id: item.id, restore: null }),
        failed: t("errors.stopTrackingFailed", { name: item.name }),
        done: {
          message: t("toast.stopped", { name: item.name }),
          undo: newest
            ? () =>
                run({
                  optimistic: status(item.id, "confirmed"),
                  call: async () => {
                    const result = await trackRecurringAction(newest.transactionId);
                    return result.status === "done" ? { status: "done" } : result;
                  },
                  failed: t("errors.undoFailed"),
                })
            : undefined,
        },
      });
    },

    stillActive(item: RecurringViewItem) {
      run({
        optimistic: status(item.id, "stillActive"),
        call: () => stillActiveRecurringAction(item.id),
        failed: t("errors.stillActiveFailed", { name: item.name }),
        done: { message: t("toast.stillActive", { name: item.name }) },
      });
    },

    /** "Keep for next month" on a regular income; Undo flips it back. */
    setKeeps(item: RecurringViewItem, value: boolean) {
      const flip = (to: boolean) => () =>
        run({
          optimistic: { kind: "keeps", id: item.id, value: to },
          call: () => setKeepsForNextMonthAction(item.id, to),
          failed: t("errors.undoFailed"),
        });
      run({
        optimistic: { kind: "keeps", id: item.id, value },
        call: () => setKeepsForNextMonthAction(item.id, value),
        failed: t("errors.keepsFailed", { name: item.name }),
        done: { message: t(value ? "toast.keepsOn" : "toast.keepsOff", { name: item.name }), undo: flip(!value) },
      });
    },

    /** One transaction on the server; Undo puts exactly these back to detected. */
    confirmAll(toConfirm: RecurringViewItem[]) {
      const ids = toConfirm.map((i) => i.id);
      if (ids.length === 0) return;
      run({
        optimistic: { kind: "status", changes: ids.map((id) => ({ id, status: "confirmed" as const })) },
        call: () => setRecurringStatusesAction(ids.map((id) => ({ id, status: "confirmed" as const }))),
        failed: t("errors.confirmAllFailed"),
        done: {
          message: t("toast.confirmedMany", { count: ids.length }),
          undo: () =>
            run({
              optimistic: { kind: "status", changes: ids.map((id) => ({ id, status: "detected" as const })) },
              call: detectedCall(ids),
              failed: t("errors.undoFailed"),
            }),
        },
      });
    },

    acceptPrice(item: RecurringViewItem) {
      if (!item.alert) return;
      const alertId = item.alert.id;
      run({
        optimistic: { kind: "alert", id: item.id, accept: true },
        call: () => acceptPriceAlertAction(alertId),
        failed: t("errors.acceptFailed", { name: item.name }),
        done: { message: t("toast.priceAccepted", { name: item.name }) },
      });
    },

    keepPrice(item: RecurringViewItem) {
      if (!item.alert) return;
      const alertId = item.alert.id;
      run({
        optimistic: { kind: "alert", id: item.id, accept: false },
        call: () => dismissPriceAlertAction(alertId),
        failed: t("errors.dismissAlertFailed", { name: item.name }),
        done: { message: t("toast.priceKept", { name: item.name }) },
      });
    },
  };
}
