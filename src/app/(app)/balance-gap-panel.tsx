"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { useToast } from "@/components/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import type { BalanceGapView } from "./balance-gap";
import { acceptBalanceGapAction, restoreBalanceGapAction } from "./balance-gap-actions";

/**
 * What to do about a gap: one sentence on what it usually means, then import the missing dates or
 * accept the bank's balance (a note, not a transaction), with Undo in the toast.
 */
export function BalanceGapPanel({
  gap,
  onAccepted,
}: {
  gap: BalanceGapView;
  /** Called once the balance is accepted, before the toast (e.g. to close the sheet around the panel). */
  onAccepted?: () => void;
}) {
  const t = useTranslations("dashboard.balanceGap");
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const accept = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await acceptBalanceGapAction(gap.accountId);
        if (result.status === "error") {
          setError(result.error);
          return;
        }
        const { checkpointId, previousCents } = result;
        onAccepted?.();
        toast.show({
          message: t("accepted"),
          undo: {
            onUndo: async () => {
              try {
                const restored = await restoreBalanceGapAction(checkpointId, previousCents);
                toast.show(
                  restored.status === "ok" ? { message: t("restored") } : { message: restored.error, variant: "error" },
                );
              } catch {
                toast.show({ message: t("undoFailed"), variant: "error" });
              }
            },
          },
        });
      } catch {
        setError(t("acceptFailed"));
      }
    });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="balance-gap-panel">
      <p className="text-sm">{t(gap.amountCents < 0 ? "explainLess" : "explainMore")}</p>
      <div className="flex flex-col gap-2">
        <Link
          href={`/import?account=${gap.accountId}`}
          className={buttonVariants({ className: "h-11" })}
          data-testid="balance-gap-import"
        >
          {t("importCsv")}
        </Link>
        <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={accept} data-testid="balance-gap-accept">
          {pending ? t("accepting") : t("accept")}
        </Button>
        <p className="text-muted-foreground text-sm">{t("acceptHint")}</p>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
