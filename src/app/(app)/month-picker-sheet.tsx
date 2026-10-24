"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";

import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { compareHref, monthNames, type ComparedMonths } from "@/lib/compare/months";
import { addMonths, dashboardHref, formatMonthLabel, formatShortMonthLabel } from "@/lib/dashboard/month";
import { buildPickerYear, pickerYearBounds, type MonthHistoryRow, type PickerCell } from "@/lib/dashboard/month-picker";
import { formatCompactCents, formatWholeCents } from "@/lib/money";
import { cn } from "@/lib/utils";

const CELL = "flex h-15 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[10px] px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function YearButton({ year, disabled, direction, onClick }: { year: number; disabled: boolean; direction: "previous" | "next"; onClick: () => void }) {
  const t = useTranslations("dashboard.monthPicker");
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={t("goToYear", { year })}
      className="bg-secondary hover:bg-muted focus-visible:ring-ring/50 flex size-11 items-center justify-center rounded-lg outline-none focus-visible:ring-[3px] disabled:opacity-35 disabled:hover:bg-secondary"
    >
      <Icon className="size-5" aria-hidden="true" />
    </button>
  );
}

function Cell({ cell, selected, href, taken }: { cell: PickerCell; selected: boolean; href: string; taken: boolean }) {
  const locale = useLocale();
  const t = useTranslations("dashboard.monthPicker");
  const short = formatShortMonthLabel(cell.month, locale);

  // The month already on the other side of a comparison: shown, never picked twice.
  if (taken) {
    return (
      <button
        type="button"
        aria-disabled="true"
        aria-label={`${formatMonthLabel(cell.month, locale)}, ${t("taken")}`}
        data-testid="month-picker-cell"
        data-state="taken"
        className={cn(CELL, "text-muted-foreground border-primary/60 cursor-default border-[1.5px] border-dashed")}
      >
        <span className="text-base font-semibold">{short}</span>
        <span className="text-xs">{t("taken")}</span>
      </button>
    );
  }
  if (cell.state !== "data") {
    return (
      <button
        type="button"
        aria-disabled="true"
        aria-label={formatMonthLabel(cell.month, locale)}
        data-testid="month-picker-cell"
        data-state={cell.state}
        className={cn(CELL, "text-muted-foreground cursor-default border border-dashed opacity-40")}
      >
        <span className="text-base font-medium">{short}</span>
      </button>
    );
  }
  return (
    <SheetClose asChild>
      <Link
        href={href}
        aria-current={selected ? "true" : undefined}
        aria-label={t("cellLabel", { month: formatMonthLabel(cell.month, locale), amount: formatWholeCents(cell.spentCents, locale) })}
        data-testid="month-picker-cell"
        data-state="data"
        className={cn(CELL, selected ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted border")}
      >
        <span className={cn("text-base", selected ? "font-bold" : "font-semibold")}>{short}</span>
        <span className={cn("text-xs tabular-nums", selected ? "opacity-85" : "text-muted-foreground")}>
          {formatCompactCents(cell.spentCents, locale)}
        </span>
      </Link>
    </SheetClose>
  );
}

/**
 * The month name as a button that opens a sheet with a year of months and what was spent in
 * each. Months are plain links, so picking one needs no state.
 */
export function MonthPickerSheet({
  month,
  current,
  history,
  compare,
}: {
  /** The selected month ("YYYY-MM"). */
  month: string;
  /** Today's month: always selectable, and the target of "Back to this month". */
  current: string;
  history: MonthHistoryRow[];
  /** On the Compare page: which side this picker changes; cells link there instead of to /budget. */
  compare?: ComparedMonths & { side: "a" | "b" };
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard.monthPicker");
  const [year, setYear] = useState(() => Number(month.slice(0, 4)));
  const { minYear, maxYear } = pickerYearBounds(history, current);
  const cells = buildPickerYear(year, history, current);
  const other = compare && (compare.side === "a" ? compare.b : compare.a);
  const otherName = compare && monthNames(compare, locale)[compare.side === "a" ? "b" : "a"].sentence;
  const hrefFor = (cellMonth: string) =>
    compare
      ? compareHref(compare.side === "a" ? { a: cellMonth, b: compare.b } : { a: compare.a, b: cellMonth })
      : dashboardHref({ month: cellMonth === current ? null : cellMonth });
  // Pill B's shortcut: the month just before A, when it can be picked and isn't already B.
  const previous = compare?.side === "b" ? addMonths(compare.a, -1) : null;
  const previousPickable = previous !== null && previous !== compare?.b && (previous === current || history.some((h) => h.month === previous && h.count > 0));

  return (
    <Sheet onOpenChange={(open) => open && setYear(Number(month.slice(0, 4)))}>
      {compare ? (
        <SheetTrigger
          aria-haspopup="dialog"
          aria-label={t("compareTrigger", { month: formatMonthLabel(month, locale) })}
          data-testid={`compare-pill-${compare.side}`}
          className={cn(
            "focus-visible:ring-ring/50 flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-base font-bold tabular-nums outline-none focus-visible:ring-[3px]",
            compare.side === "a" ? "bg-primary text-primary-foreground" : "bg-primary/20 border-primary/45 border",
          )}
        >
          <span className="truncate">{`${formatShortMonthLabel(month, locale)} ${month.slice(0, 4)}`}</span>
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </SheetTrigger>
      ) : (
        <SheetTrigger
          aria-haspopup="dialog"
          data-testid="month-picker-trigger"
          className="hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-bold outline-none focus-visible:ring-[3px]"
        >
          {formatMonthLabel(month, locale)}
          <ChevronDown className="text-muted-foreground size-3" aria-hidden="true" />
        </SheetTrigger>
      )}
      <SheetContent
        title={otherName ? t("compareTitle", { month: otherName }) : t("title")}
        description={otherName ? t("compareDescription", { month: otherName }) : t("description")}
        data-testid="month-picker"
        className="theme-50f"
      >
        <div className="flex items-center justify-between">
          <YearButton year={year - 1} direction="previous" disabled={year <= minYear} onClick={() => setYear(year - 1)} />
          <p className="text-xl font-extrabold tabular-nums" aria-live="polite">
            {year}
          </p>
          <YearButton year={year + 1} direction="next" disabled={year >= maxYear} onClick={() => setYear(year + 1)} />
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {cells.map((cell) => (
            <Cell key={cell.month} cell={cell} selected={cell.month === month} href={hrefFor(cell.month)} taken={cell.month === other} />
          ))}
        </div>
        <p className="text-muted-foreground text-center text-[13px]">{t("footnote")}</p>
        {compare ? (
          previous &&
          previousPickable && (
            <SheetClose asChild>
              <Link
                href={compareHref({ a: compare.a, b: previous })}
                className="text-primary hover:bg-muted focus-visible:ring-ring/50 flex h-13 w-full items-center justify-center rounded-lg text-base font-bold outline-none focus-visible:ring-[3px]"
              >
                {t("previousMonth", { month: monthNames({ a: compare.a, b: previous }, locale).b.sentence })}
              </Link>
            </SheetClose>
          )
        ) : month !== current && (
          <SheetClose asChild>
            <Link
              href={dashboardHref({})}
              className="text-primary hover:bg-muted focus-visible:ring-ring/50 flex h-13 w-full items-center justify-center rounded-lg text-base font-bold outline-none focus-visible:ring-[3px]"
            >
              {t("backToThisMonth")}
            </Link>
          </SheetClose>
        )}
      </SheetContent>
    </Sheet>
  );
}
