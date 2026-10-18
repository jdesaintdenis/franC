"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { useToday } from "@/components/today-provider";
import { formatDayRange } from "@/lib/format-date";
import { offersBulkReview } from "@/lib/import/bulk-review";

import { HomeSection } from "../home/home-section";
import type { ConfirmState } from "./actions";
import { BulkReview } from "./bulk-review";
import { UndoImportDialog } from "./undo-import-dialog";

type Done = Extract<NonNullable<ConfirmState>, { status: "done" }>;

/** The result screen: what came in, what is left to do, what the file also held, and the way out. */
export function ImportResult({ done, filename, reset }: { done: Done; filename: string; reset: () => void }) {
  const t = useTranslations("import.result");
  const locale = useLocale();
  const today = useToday();
  const [undoing, setUndoing] = useState(false);
  const bulk = offersBulkReview({ firstImport: done.firstImport, inserted: done.inserted });
  const hasTodo = done.transfersFound > 0 || done.priceAlerts > 0 || done.inserted > 0;

  return (
    <section aria-label={t("region")} className="flex flex-col gap-4">
      <div className="bg-card flex flex-col gap-1 rounded-[10px] border p-3.5">
        <p role="status" className="text-xl font-extrabold">
          {t("imported", { count: done.inserted })}
        </p>
        {done.dateRange && (
          <p className="font-title text-primary text-xs font-semibold tracking-[0.1em] uppercase">
            {formatDayRange(done.dateRange.from, done.dateRange.to, today, locale)}
          </p>
        )}
      </div>

      {hasTodo && (
        <HomeSection headingId="import-todo-heading" title={t("toDo")}>
          <div className="flex flex-col gap-3 text-sm">
            {bulk ? (
              <BulkReview importId={done.importId} />
            ) : (
              done.inserted > 0 && (
                <Link href="/review" className="bg-primary text-primary-foreground flex min-h-11 items-center justify-center rounded-xl px-3 font-bold">
                  {t("reviewNew", { count: done.inserted })}
                </Link>
              )
            )}
            {done.transfersFound > 0 && (
              <p>
                {t("transfersFound", { count: done.transfersFound })}{" "}
                <Link href="/transactions?transfers=only" className="text-primary font-semibold">
                  {t("open")}
                </Link>
              </p>
            )}
            {done.priceAlerts > 0 && (
              <p>
                {t("priceAlerts", { count: done.priceAlerts })}{" "}
                <Link href="/recurring" className="text-primary font-semibold">
                  {t("open")}
                </Link>
              </p>
            )}
          </div>
        </HomeSection>
      )}

      <HomeSection headingId="import-found-heading" title={t("found")}>
        <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
          <li>{t("summary", { inserted: done.inserted, duplicate: done.duplicate, error: done.error })}</li>
          {done.backfilled > 0 && <li>{t("backfilled", { backfilled: done.backfilled })}</li>}
          {done.guessed > 0 && !bulk && <li>{t("guessed", { count: done.guessed })}</li>}
        </ul>
      </HomeSection>

      <div className="flex flex-col items-stretch">
        <button type="button" onClick={reset} className="bg-secondary min-h-11 rounded-[10px] font-semibold">
          {t("another")}
        </button>
        {done.inserted > 0 && (
          <button
            type="button"
            onClick={() => setUndoing(true)}
            className="text-muted-foreground min-h-11 self-center text-[13px]"
          >
            {t("undo")}
          </button>
        )}
      </div>
      <UndoImportDialog
        open={undoing}
        onOpenChange={setUndoing}
        importId={done.importId}
        filename={filename}
        rowsInserted={done.inserted}
        onUndone={reset}
      />
    </section>
  );
}
