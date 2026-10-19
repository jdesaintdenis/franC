"use client";

import { Check, ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";

import { useToday } from "@/components/today-provider";
import { Button } from "@/components/ui/button";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import { formatDay } from "@/lib/format-date";
import { DATE_FORMATS, type DateFormat } from "@/lib/import/date";
import {
  columnIndex,
  columnSample,
  completeMapping,
  dateFormatsReading,
  guessDateFormat,
  guessDecimal,
  type CsvMapping,
  type MappingDraft,
} from "@/lib/import/mapping";
import { parseWithMapping } from "@/lib/import/parse";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { HomeSection } from "../home/home-section";
import { ActionBar } from "./action-bar";
import type { ColumnsInfo } from "./actions";
import { describeIssue } from "./import-summary";

/** Message keys for the date formats: a format's own text has characters a key cannot hold. */
const DATE_FORMAT_KEY = {
  "DD/MM/YYYY": "dmySlash",
  "DD/MM/YY": "dmySlash2",
  "DD-MM-YYYY": "dmyDash",
  "DD.MM.YYYY": "dmyDot",
  "YYYY-MM-DD": "ymdDash",
  "MM/DD/YYYY": "mdySlash",
} as const satisfies Record<DateFormat, string>;

type ColumnField = "date" | "label" | "amount" | "debit" | "credit" | "shortLabel" | "bookedOn" | "category" | "subcategory";

/**
 * The step every import goes through: which column of this file holds the date, the label and the
 * amount, and how they are written. It opens filled in (the last import's choices, else a guess from
 * the header names) and shows how the first row would be read, so a wrong choice is visible before
 * anything is previewed.
 */
export function ColumnMapping({
  filename,
  accountName,
  columns,
  initial,
  remembered,
  pending,
  onContinue,
  onCancel,
}: {
  filename: string;
  accountName: string;
  columns: ColumnsInfo;
  initial: MappingDraft;
  remembered: boolean;
  pending: boolean;
  onContinue: (mapping: CsvMapping) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("import.mapping");
  const tActions = useTranslations("common.actions");
  const [draft, setDraft] = useState(initial);
  const complete = completeMapping(draft);
  const set = <K extends keyof MappingDraft>(key: K, value: MappingDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const table = { headers: columns.headers, rows: columns.sampleRows };
  /** A newly chosen column also settles how its values are written, so the user is not asked twice. */
  function choose(field: ColumnField, value: string | null) {
    setDraft((d) => {
      const next = { ...d, [field]: value };
      if (field === "date" && value !== null) next.dateFormat = guessDateFormat(columnSample(table, value));
      if ((field === "amount" || field === "debit" || field === "credit") && value !== null) {
        const names = next.amountKind === "single" ? [next.amount] : [next.debit, next.credit];
        next.decimal = guessDecimal(names.flatMap((n) => columnSample(table, n)));
      }
      return next;
    });
  }
  const otherChosen = [draft.shortLabel, draft.bookedOn, draft.category, draft.subcategory].filter((c) => c !== null).length;

  const select = (field: ColumnField, label: string, optional = false, hideLabel = false) => (
    <ColumnSelect
      label={label}
      hideLabel={hideLabel}
      value={draft[field]}
      onChange={(value) => choose(field, value)}
      columns={columns}
      emptyLabel={optional ? t("none") : t("chooseColumn")}
    />
  );

  return (
    <section aria-label={t("title")} className="flex flex-col gap-4">
      <div className="bg-card flex flex-col gap-2 rounded-[10px] border p-3.5">
        <p className="text-muted-foreground text-xs break-all">
          {filename} · {accountName}
        </p>
        <p className="text-lg leading-tight font-extrabold">
          {t("rowsColumns", { rows: columns.rowsTotal, columns: columns.headers.length })}
        </p>
        {remembered ? (
          <p className="bg-positive-soft text-positive flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold">
            <Check aria-hidden="true" className="size-3.5" />
            {t("remembered")}
          </p>
        ) : (
          completeMapping(initial) === null && <p className="text-muted-foreground text-sm">{t("newFormat")}</p>
        )}
      </div>

      <HomeSection headingId="mapping-columns-heading" title={t("columns")} flush>
        <div className="divide-border divide-y">
          <div className="flex flex-col gap-1.5 px-3.5 py-3">{select("date", t("date"))}</div>
          <div className="flex flex-col gap-1.5 px-3.5 py-3">
            {select("label", t("label"))}
            <p className="text-muted-foreground text-xs">{t("labelHint")}</p>
          </div>
          <div className="flex flex-col gap-2 px-3.5 py-3">
            <span className="text-sm font-semibold">{t("amount")}</span>
            <div role="radiogroup" aria-label={t("amount")} className="flex flex-wrap gap-2">
              {(["single", "split"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={draft.amountKind === kind}
                  onClick={() => set("amountKind", kind)}
                  className={cn(
                    "focus-visible:ring-ring/50 min-h-10 rounded-full px-4 text-[13px] font-semibold outline-none focus-visible:ring-[3px]",
                    draft.amountKind === kind ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
                  )}
                >
                  {kind === "single" ? t("amountSingle") : t("amountSplit")}
                </button>
              ))}
            </div>
            {draft.amountKind === "single" ? (
              select("amount", t("amount"), false, true)
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex flex-col gap-1.5">{select("debit", t("debit"))}</div>
                <div className="flex flex-col gap-1.5">{select("credit", t("credit"))}</div>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 px-3.5 py-3">
            <span className="text-sm font-semibold">{t("format")}</span>
            <div className="grid grid-cols-2 gap-2.5">
              <FormatSelect
                label={t("dates")}
                value={draft.dateFormat}
                onChange={(value) => set("dateFormat", value as DateFormat)}
                options={DATE_FORMATS.map((f) => ({ value: f, label: t(`dateFormats.${DATE_FORMAT_KEY[f]}`) }))}
              />
              <FormatSelect
                label={t("amounts")}
                value={draft.decimal}
                onChange={(value) => set("decimal", value === "." ? "." : ",")}
                options={[
                  { value: ",", label: t("decimalComma") },
                  { value: ".", label: t("decimalDot") },
                ]}
              />
            </div>
          </div>
          <details className="group">
            <summary className="text-primary focus-visible:ring-ring/50 flex min-h-12 cursor-pointer items-center justify-between px-3.5 text-sm font-semibold outline-none focus-visible:ring-[3px]">
              {t("moreChosen", { count: otherChosen })}
              <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <div className="divide-border divide-y border-t">
              <div className="flex flex-col gap-1.5 px-3.5 py-3">{select("shortLabel", t("shortLabel"), true)}</div>
              <div className="flex flex-col gap-1.5 px-3.5 py-3">{select("bookedOn", t("bookedOn"), true)}</div>
              <div className="flex flex-col gap-1.5 px-3.5 py-3">{select("category", t("category"), true)}</div>
              <div className="flex flex-col gap-1.5 px-3.5 py-3">{select("subcategory", t("subcategory"), true)}</div>
            </div>
          </details>
        </div>
      </HomeSection>

      <FirstRow columns={columns} mapping={complete} onUseFormat={(format) => set("dateFormat", format)} />

      <ActionBar>
        <Button
          type="button"
          className="h-12 w-full rounded-xl font-bold"
          pending={pending}
          disabled={complete === null}
          onClick={() => complete && onContinue(complete)}
        >
          {t("continue")}
        </Button>
        <button type="button" onClick={onCancel} disabled={pending} className="text-muted-foreground min-h-10 text-[13px] font-semibold">
          {tActions("cancel")}
        </button>
      </ActionBar>
    </section>
  );
}

function ColumnSelect({
  label,
  hideLabel,
  value,
  onChange,
  columns,
  emptyLabel,
}: {
  label: string;
  /** The label is only for screen readers (the field already has a visible caption). */
  hideLabel: boolean;
  value: string | null;
  onChange: (value: string | null) => void;
  columns: ColumnsInfo;
  emptyLabel: string;
}) {
  const id = useId();
  const example = columnSample({ headers: columns.headers, rows: columns.sampleRows }, value)[0] ?? null;
  return (
    <>
      <label htmlFor={id} className={cn("text-sm font-semibold", hideLabel && "sr-only")}>
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className={cn(NATIVE_SELECT_CLASS, "h-11", value === null && "text-muted-foreground")}
      >
        <option value="">{emptyLabel}</option>
        {columns.headers.map((header, i) => (
          <option key={i} value={header}>
            {header}
          </option>
        ))}
      </select>
      {example !== null && <span className="text-muted-foreground truncate text-xs">{example}</span>}
    </>
  );
}

function FormatSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(NATIVE_SELECT_CLASS, "h-11")}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The file's first row read with the current choices, or what is wrong with it and a one-tap fix. */
function FirstRow({
  columns,
  mapping,
  onUseFormat,
}: {
  columns: ColumnsInfo;
  mapping: CsvMapping | null;
  onUseFormat: (format: DateFormat) => void;
}) {
  const t = useTranslations("import.mapping");
  const tIssues = useTranslations("import.rowIssues");
  const locale = useLocale();
  const today = useToday();
  const first = columns.sampleRows[0];

  const result = mapping && first ? parseWithMapping({ headers: columns.headers, rows: columns.sampleRows }, mapping) : null;
  const read = result?.ok ? result.transactions.find((tx) => tx.line === first.line) : undefined;
  const failure = result?.ok ? result.errors.find((e) => e.line === first.line) : undefined;

  let body: ReactNode;
  if (read) {
    body = (
      <div className="grid min-h-11 grid-cols-[64px_1fr_auto] items-center gap-2.5 px-3.5 text-sm">
        <span className="text-muted-foreground text-xs">{formatDay(read.date, today, locale)}</span>
        <span className="truncate">{read.labelSimplified || read.labelRaw}</span>
        <span className={cn("font-bold tabular-nums", read.amountCents > 0 && "text-positive")}>
          {read.amountCents > 0 ? "+" : ""}
          {formatCents(read.amountCents, locale)}
        </span>
      </div>
    );
  } else if (failure && mapping && result?.ok) {
    const badDate = failure.issues.some((i) => i.code === "invalidDate");
    const dateCell = first.cells[columnIndex(columns.headers, mapping.date)] ?? "";
    const suggestion = badDate ? dateFormatsReading(dateCell.trim()).find((f) => f !== mapping.dateFormat) : undefined;
    body = (
      <div className="border-warning/45 bg-card flex flex-col gap-2 rounded-[10px] border p-3.5">
        <p className="text-warning text-sm font-semibold">
          {badDate ? t("badDate", { value: dateCell.trim() }) : failure.issues.map((i) => describeIssue(tIssues, i)).join("; ")}
        </p>
        <p className="text-muted-foreground text-xs">
          {t("rowsRefused", { refused: result.errors.length, count: columns.sampleRows.length })}
        </p>
        {suggestion && (
          <button
            type="button"
            onClick={() => onUseFormat(suggestion)}
            className="bg-primary text-primary-foreground focus-visible:ring-ring/50 min-h-8 w-fit rounded-full px-3 text-xs font-semibold outline-none focus-visible:ring-[3px]"
          >
            {t("useFormat", { format: t(`dateFormats.${DATE_FORMAT_KEY[suggestion]}`) })}
          </button>
        )}
      </div>
    );
  } else {
    body = <p className="text-muted-foreground text-sm">{t("firstRowPending")}</p>;
  }

  const flush = read !== undefined;
  return (
    <HomeSection headingId="mapping-first-row-heading" title={t("firstRow")} flush={flush} bare={!flush && failure !== undefined}>
      {body}
    </HomeSection>
  );
}
