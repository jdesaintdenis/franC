"use client";

import { ArrowLeftRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { TransactionListItem } from "@/db/queries/transactions";
import type { TransferCandidate, TransferForTransaction } from "@/db/queries/transfers";
import { formatDay } from "@/lib/format-date";
import { useToday } from "@/components/today-provider";
import { formatCents, formatSignedCents } from "@/lib/money";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";

import type { SavingsAccountOption } from "./savings-step";

import {
  confirmTransferAction,
  getTransferInfo,
  linkTransferAction,
  setMoveGoalAction,
  unlinkTransferAction,
  type TransferChangeResult,
  type TransferErrorCode,
} from "./actions";

/** New transfer state for a loaded row; null clears it. */
export interface TransferPatch {
  id: string;
  transfer: TransactionListItem["transfer"];
}

/** What a change did, so the sheet can say so and offer the reverse as Undo. */
export type TransferChange =
  | { kind: "link"; transferId: string; counterpart: TransferCandidate }
  | { kind: "confirm"; transferId: string }
  | { kind: "unlink"; counterpartId: string }
  // A pair franC created (Move to savings) was undone: the created row is gone, the source row is `sourceId`.
  // `goalId` is the goal the money went to, so Undo moves it there again.
  | { kind: "unmove"; sourceId: string; accountId: string; goalId: string | null };

interface Props {
  item: TransactionListItem;
  /** Called after a link, confirm or unlink so the list can patch both rows in place. */
  onChanged: (patches: TransferPatch[]) => void;
  /** Called after `onChanged`, with what happened. */
  onResult?: (change: TransferChange) => void;
  /** False when the surrounding step already has the heading. */
  showHeading?: boolean;
  /** The user's Savings accounts with their goals, for changing the goal of a move. */
  savingsAccounts?: SavingsAccountOption[];
}

type Loaded = { transfer: TransferForTransaction | null; candidates: TransferCandidate[] };

function toListTransfer(
  id: string,
  status: "detected" | "confirmed",
  other: { accountName: string; date: string; amountCents: number },
): NonNullable<TransactionListItem["transfer"]> {
  return {
    id,
    status,
    counterpartAccountName: other.accountName,
    counterpartDate: other.date,
    counterpartAmountCents: other.amountCents,
  };
}

export function TransferSection({ item, onChanged, onResult, showHeading = true, savingsAccounts = [] }: Props) {
  const locale = useLocale();
  const today = useToday();
  const t = useTranslations("transactions.transfer");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Changing the goal of a move (Slice 55): the open picker, its choice and the confirmation.
  const [pickingGoal, setPickingGoal] = useState(false);
  const [goalChoice, setGoalChoice] = useState("");
  const [goalSaved, setGoalSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTransferInfo({ transactionId: item.id })
      .then((result) => {
        if (cancelled) return;
        if (result.status === "done") setLoaded({ transfer: result.transfer, candidates: result.candidates });
        else setLoadFailed(true);
      })
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  function errorText(code: TransferErrorCode): string {
    return t(`errors.${code}`);
  }

  /** Runs a change action and applies its outcome; `apply` turns success into row patches. */
  function run(
    action: () => Promise<TransferChangeResult>,
    apply: (transfer: TransferForTransaction | null) => TransferPatch[],
    describe: (transfer: TransferForTransaction | null) => TransferChange | null,
  ) {
    setError(null);
    startTransition(async () => {
      let result: TransferChangeResult;
      try {
        result = await action();
      } catch {
        setError(t("errors.failed"));
        return;
      }
      if (result.status === "error") {
        setError(errorText(result.error));
        return;
      }
      setLoaded({ transfer: result.transfer, candidates: [] });
      setShowCandidates(false);
      onChanged(apply(result.transfer));
      const change = describe(result.transfer);
      if (change) onResult?.(change);
    });
  }

  function describeSelf(): { accountName: string; date: string; amountCents: number } {
    return { accountName: item.accountName, date: item.date, amountCents: item.amountCents };
  }

  const transfer = loaded?.transfer ?? null;
  const movedByFranc = transfer !== null && (transfer.selfCreatedByFranc || transfer.counterpart.createdByFranc);

  function link(candidate: TransferCandidate) {
    run(
      () => linkTransferAction({ transactionId: item.id, counterpartId: candidate.id }),
      (linked) =>
        linked
          ? [
              { id: item.id, transfer: toListTransfer(linked.id, linked.status, linked.counterpart) },
              { id: linked.counterpart.id, transfer: toListTransfer(linked.id, linked.status, describeSelf()) },
            ]
          : [],
      (linked) => (linked ? { kind: "link", transferId: linked.id, counterpart: candidate } : null),
    );
  }

  function confirm(current: TransferForTransaction) {
    run(
      () => confirmTransferAction({ transferId: current.id, transactionId: item.id }),
      (confirmed) =>
        confirmed
          ? [
              { id: item.id, transfer: toListTransfer(confirmed.id, confirmed.status, confirmed.counterpart) },
              { id: confirmed.counterpart.id, transfer: toListTransfer(confirmed.id, confirmed.status, describeSelf()) },
            ]
          : [],
      (confirmed) => (confirmed ? { kind: "confirm", transferId: confirmed.id } : null),
    );
  }

  function unlink(current: TransferForTransaction) {
    // Unlinking a pair franC created deletes the created row, so Undo moves the money again instead of relinking.
    const created = current.selfCreatedByFranc || current.counterpart.createdByFranc;
    run(
      () => unlinkTransferAction({ transferId: current.id, transactionId: item.id }),
      () => [
        { id: item.id, transfer: null },
        { id: current.counterpart.id, transfer: null },
      ],
      () =>
        created
          ? {
              kind: "unmove",
              sourceId: current.selfCreatedByFranc ? current.counterpart.id : item.id,
              accountId: current.selfCreatedByFranc ? item.accountId : current.counterpart.accountId,
              goalId: current.goal?.id ?? null,
            }
          : { kind: "unlink", counterpartId: current.counterpart.id },
    );
  }

  const goalAccount = transfer?.savingsLeg ? savingsAccounts.find((a) => a.id === transfer.savingsLeg?.accountId) : undefined;

  function saveGoal(current: TransferForTransaction) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setMoveGoalAction({ transferId: current.id, transactionId: item.id, goalId: goalChoice === "" ? null : goalChoice });
        if (result.status === "error") {
          setError(errorText(result.error));
          return;
        }
        setLoaded({ transfer: result.transfer, candidates: [] });
        setPickingGoal(false);
        setGoalSaved(true);
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  return (
    <section
      aria-labelledby={showHeading ? "transfer-heading" : undefined}
      data-testid="transfer-section"
      className={showHeading ? "flex flex-col gap-3 border-t pt-4" : "flex flex-col gap-3"}
    >
      {showHeading && (
        <h3 id="transfer-heading" className="flex items-center gap-2 text-sm font-medium">
          <ArrowLeftRight aria-hidden="true" className="size-4" />
          {t("heading")}
        </h3>
      )}

      {loadFailed && <p className="text-muted-foreground text-sm">{t("errors.failed")}</p>}
      {!loaded && !loadFailed && <p className="text-muted-foreground text-sm">{t("loading")}</p>}

      {transfer && (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs">
            {movedByFranc ? t("statusMoved") : transfer.status === "detected" ? t("statusDetected") : t("statusConfirmed")}
          </p>
          <div data-testid="transfer-counterpart" className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">{transfer.counterpart.label}</span>
              <span className="text-muted-foreground truncate text-xs">
                {transfer.counterpart.accountName} · {formatDay(transfer.counterpart.date, today, locale)}
              </span>
            </div>
            <span className="shrink-0 tabular-nums">{formatSignedCents(transfer.counterpart.amountCents, locale)}</span>
          </div>
          {goalAccount && transfer.savingsLeg && (
            <div data-testid="move-goal" className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 break-words">{transfer.goal ? t("goalLine", { goal: transfer.goal.name }) : t("goalNone")}</span>
                {!pickingGoal && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 shrink-0"
                    disabled={isPending}
                    onClick={() => {
                      setGoalChoice(transfer.goal?.id ?? "");
                      setGoalSaved(false);
                      setPickingGoal(true);
                    }}
                  >
                    {t("goalChange")}
                  </Button>
                )}
              </div>
              {pickingGoal && (
                <div className="flex gap-2">
                  <select aria-label={t("goalSelect")} value={goalChoice} onChange={(e) => setGoalChoice(e.target.value)} className={`${NATIVE_SELECT_CLASS} h-11 flex-1`}>
                    <option value="">{t("goalNone")}</option>
                    {goalAccount.goals.map((goal) => {
                      // Money out of a Savings account has to come from a goal that holds enough.
                      const short = (transfer.savingsLeg?.amountCents ?? 0) < 0 && goal.id !== transfer.goal?.id && goal.savedCents < Math.abs(transfer.savingsLeg?.amountCents ?? 0);
                      return (
                        <option key={goal.id} value={goal.id} disabled={short}>
                          {goal.name} · {formatCents(goal.savedCents, locale)}
                        </option>
                      );
                    })}
                  </select>
                  <Button type="button" className="h-11" disabled={isPending} onClick={() => saveGoal(transfer)}>
                    {t("goalSave")}
                  </Button>
                </div>
              )}
              {goalSaved && !pickingGoal && <p role="status" className="text-muted-foreground text-xs">{t("goalChanged")}</p>}
            </div>
          )}
          <div className="flex gap-2">
            {transfer.status === "detected" && (
              <Button type="button" className="h-11 flex-1" disabled={isPending} onClick={() => confirm(transfer)}>
                {t("confirm")}
              </Button>
            )}
            <Button type="button" variant="outline" className="h-11 flex-1" disabled={isPending} onClick={() => unlink(transfer)}>
              {movedByFranc ? t("removeMove") : t("unlink")}
            </Button>
          </div>
        </div>
      )}

      {loaded && !transfer && item.split && <p className="text-muted-foreground text-sm">{t("splitNote")}</p>}

      {loaded && !transfer && !item.split && (
        <div className="flex flex-col gap-3">
          {!showCandidates ? (
            <Button type="button" variant="outline" className="h-11" disabled={isPending} onClick={() => setShowCandidates(true)}>
              {t("mark")}
            </Button>
          ) : loaded.candidates.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noCandidates")}</p>
          ) : (
            <ul aria-label={t("candidates")} className="flex flex-col gap-2">
              {loaded.candidates.map((c) => (
                <li key={c.id} data-testid="transfer-candidate" className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">{c.label}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {c.accountName} · {formatDay(c.date, today, locale)} · {formatSignedCents(c.amountCents, locale)}
                    </span>
                  </div>
                  <Button type="button" size="sm" className="min-h-11 shrink-0" disabled={isPending} onClick={() => link(c)}>
                    {t("link")}
                    <span className="sr-only"> {c.label}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
