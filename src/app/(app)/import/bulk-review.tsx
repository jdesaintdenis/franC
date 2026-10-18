"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { useToast } from "@/components/toast";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { guessAndReviewImportAction, undoReviewedAction } from "../review/actions";

// Matches the review actions' per-call id cap.
const UNDO_CHUNK = 500;

type Outcome = { reviewedIds: string[]; leftUncategorized: number };

/**
 * Result screen after a first or large import: one button that guesses categories and
 * marks the categorized rows reviewed, with "Review one by one" as the alternative.
 */
export function BulkReview({ importId }: { importId: string }) {
  const t = useTranslations("import.result");
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function undo(ids: string[]) {
    for (let i = 0; i < ids.length; i += UNDO_CHUNK) {
      const result = await undoReviewedAction({ ids: ids.slice(i, i + UNDO_CHUNK) });
      if (result.status === "error") {
        toast.show({ message: t("undoFailed"), variant: "error" });
        return;
      }
    }
    // Back to the first screen of the result: the rows wait in the queue again.
    setOutcome(null);
  }

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await guessAndReviewImportAction({ importId });
        if (result.status === "error") {
          setError(t("bulkFailed"));
          return;
        }
        setOutcome({ reviewedIds: result.reviewedIds, leftUncategorized: result.leftUncategorized });
        if (result.reviewedIds.length > 0) {
          const ids = result.reviewedIds;
          toast.show({
            message: t("bulkToast", { count: ids.length }),
            undo: { onUndo: () => undo(ids) },
          });
        }
      } catch {
        setError(t("bulkFailed"));
      }
    });
  }

  if (outcome) {
    return (
      <div className="flex flex-col gap-3" data-testid="bulk-outcome">
        <p className="text-sm">
          {t("bulkDone", { count: outcome.reviewedIds.length })}
          {outcome.leftUncategorized > 0 && (
            <>
              {" "}
              {t("bulkLeft", { count: outcome.leftUncategorized })}{" "}
              <Link href="/review" className="text-primary font-semibold">
                {t("bulkLeftLink")}
              </Link>
            </>
          )}
          {outcome.leftUncategorized === 0 && <> {t("bulkAllDone")}</>}
        </p>
        {outcome.leftUncategorized === 0 && (
          <Link href="/" className={buttonVariants({ className: "h-12 w-full rounded-xl font-bold" })}>
            {t("goHome")}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        disabled={pending}
        onClick={run}
        className={cn(
          "bg-primary text-primary-foreground focus-visible:ring-ring/50 flex w-full flex-col items-start gap-1 rounded-xl p-3.5 text-left whitespace-normal outline-none focus-visible:ring-[3px] disabled:opacity-70",
        )}
      >
        <span className="text-base font-bold">{pending ? t("bulkPending") : t("bulkButton")}</span>
        {!pending && <span className="text-xs opacity-80">{t("bulkHint")}</span>}
      </button>
      <Link href="/review" className="bg-secondary flex min-h-11 w-full items-center justify-center rounded-[10px] font-semibold">
        {t("reviewOneByOne")}
      </Link>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
