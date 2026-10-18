"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { HomeSection } from "../home/home-section";
import { useToday } from "@/components/today-provider";
import { formatDay } from "@/lib/format-date";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import type { PreviewRow } from "./actions";

const FOLDED = 4;

/** The first new rows of the file: four visible, "See all" shows the rest of the sample. */
export function OperationsSample({ sample, total }: { sample: PreviewRow[]; total: number }) {
  const t = useTranslations("import.preview");
  const locale = useLocale();
  const today = useToday();
  const [all, setAll] = useState(false);
  const shown = all ? sample : sample.slice(0, FOLDED);

  return (
    <HomeSection
      headingId="import-sample-heading"
      title={t("sampleTitle")}
      flush
      action={!all && sample.length > FOLDED ? { label: t("showAll", { count: total }), onClick: () => setAll(true) } : undefined}
    >
      <ul aria-label={t("newList")} className="divide-border divide-y text-sm">
        {shown.map((row) => (
          <li key={row.line} className="grid min-h-11 grid-cols-[64px_1fr_auto] items-center gap-2.5 px-3.5">
            <span className="text-muted-foreground text-xs">{formatDay(row.date, today, locale)}</span>
            <span className="truncate">{row.label}</span>
            <span className={cn("font-bold tabular-nums", row.amountCents > 0 && "text-positive")}>
              {row.amountCents > 0 ? "+" : ""}
              {formatCents(row.amountCents, locale)}
            </span>
          </li>
        ))}
      </ul>
      {all && total > sample.length && (
        <p className="text-muted-foreground border-t px-3.5 py-2.5 text-xs">{t("showingFirstN", { shown: sample.length, total })}</p>
      )}
    </HomeSection>
  );
}
