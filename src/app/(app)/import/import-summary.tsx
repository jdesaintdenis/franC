"use client";

import { useLocale, useTranslations } from "next-intl";

import { useToday } from "@/components/today-provider";
import type { RowIssue } from "@/lib/import";
import { formatDayRange } from "@/lib/format-date";

import { FlowTotals } from "./flow-totals";

type IssueTranslator = ReturnType<typeof useTranslations<"import.rowIssues">>;

export function describeIssue(t: IssueTranslator, issue: RowIssue): string {
  return issue.code === "columnCount" ? t("columnCount", { expected: issue.expected, found: issue.found }) : t(issue.code);
}

/** The preview's headline card: file, account, period, how many new rows, the money, and what is left out. */
export function ImportSummary({
  filename,
  accountName,
  counts,
  dateRange,
  flows,
  errors,
  errorsOmitted,
  onChangeColumns,
  columnsSummary,
}: {
  filename: string;
  accountName: string;
  counts: { new: number; duplicate: number; error: number; possible?: number };
  dateRange: { from: string; to: string } | null;
  flows: { inCents: number; outCents: number; netCents: number };
  errors: { line: number; issues: RowIssue[] }[];
  errorsOmitted: number;
  /** Back to the Columns step, with what was chosen there summed up on one line. */
  onChangeColumns: () => void;
  columnsSummary: string;
}) {
  const t = useTranslations("import.preview");
  const tIssues = useTranslations("import.rowIssues");
  const locale = useLocale();
  const today = useToday();

  return (
    <div className="bg-card flex flex-col gap-2.5 rounded-[10px] border p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-muted-foreground text-xs break-all">
          {filename} · {accountName}
        </p>
        {dateRange && (
          <p className="font-title text-primary text-xs font-semibold tracking-[0.1em] uppercase">
            {formatDayRange(dateRange.from, dateRange.to, today, locale)}
          </p>
        )}
      </div>
      {counts.new > 0 ? (
        <p className="flex flex-wrap items-baseline gap-2">
          <b data-testid="import-new-count" className="text-[28px] leading-none font-extrabold tabular-nums">
            {counts.new}
          </b>
          <span className="text-muted-foreground">{t("newOps", { count: counts.new })}</span>
        </p>
      ) : (
        <p className="text-[22px] leading-tight font-extrabold">{t("nothingNew")}</p>
      )}
      {counts.new > 0 && <FlowTotals flows={flows} />}
      {counts.new === 0 && (
        <p className="text-muted-foreground text-sm">
          {counts.duplicate > 0 ? t("allDuplicatesShort", { count: counts.duplicate }) : t("noNew")}
        </p>
      )}
      {counts.new > 0 && counts.duplicate > 0 && (
        <p className="text-muted-foreground text-[13px]">{t("alreadyIn", { count: counts.duplicate })}</p>
      )}
      {(counts.possible ?? 0) > 0 && (
        <p data-testid="import-possible" className="text-sm">
          {t("possibleCount", { count: counts.possible ?? 0 })}
        </p>
      )}
      <div className="border-border flex items-center justify-between gap-3 border-t pt-2.5">
        <p className="text-muted-foreground truncate text-xs">{t("columnsLine", { columns: columnsSummary })}</p>
        <button
          type="button"
          onClick={onChangeColumns}
          aria-label={t("changeColumnsLabel")}
          className="text-primary focus-visible:ring-ring/50 -my-2 min-h-11 shrink-0 rounded-md px-1 text-[13px] font-semibold outline-none focus-visible:ring-[3px]"
        >
          {t("changeColumns")}
        </button>
      </div>
      {counts.error > 0 && (
        <div className="bg-warning-soft text-warning flex flex-col gap-1 rounded-lg px-2.5 py-2 text-xs">
          <p>{t("unreadable", { count: counts.error })}</p>
          <details>
            <summary className="min-h-8 w-fit cursor-pointer py-1 font-semibold">{t("unreadableSee")}</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {errors.map((e) => (
                <li key={e.line}>
                  {t("errorLine", { line: e.line, messages: e.issues.map((issue) => describeIssue(tIssues, issue)).join("; ") })}
                </li>
              ))}
            </ul>
            {errorsOmitted > 0 && <p className="mt-1">{t("errorsOmitted", { count: errorsOmitted })}</p>}
          </details>
        </div>
      )}
    </div>
  );
}
