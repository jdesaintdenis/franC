"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";

import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { dashboardHref, formatMonthLabel, formatShortMonthLabel } from "@/lib/dashboard/month";
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

function Cell({ cell, selected, current }: { cell: PickerCell; selected: boolean; current: string }) {
  const locale = useLocale();
  const t = useTranslations("dashboard.monthPicker");
  const short = formatShortMonthLabel(cell.month, locale);

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
        href={dashboardHref({ month: cell.month === current ? null : cell.month })}
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
}: {
  /** The selected month ("YYYY-MM"). */
  month: string;
  /** Today's month: always selectable, and the target of "Back to this month". */
  current: string;
  history: MonthHistoryRow[];
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard.monthPicker");
  const [year, setYear] = useState(() => Number(month.slice(0, 4)));
  const { minYear, maxYear } = pickerYearBounds(history, current);
  const cells = buildPickerYear(year, history, current);

  return (
    <Sheet onOpenChange={(open) => open && setYear(Number(month.slice(0, 4)))}>
      <SheetTrigger
        aria-haspopup="dialog"
        data-testid="month-picker-trigger"
        className="hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-bold outline-none focus-visible:ring-[3px]"
      >
        {formatMonthLabel(month, locale)}
        <ChevronDown className="text-muted-foreground size-3" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent title={t("title")} description={t("description")} data-testid="month-picker" className="theme-50f">
        <div className="flex items-center justify-between">
          <YearButton year={year - 1} direction="previous" disabled={year <= minYear} onClick={() => setYear(year - 1)} />
          <p className="text-xl font-extrabold tabular-nums" aria-live="polite">
            {year}
          </p>
          <YearButton year={year + 1} direction="next" disabled={year >= maxYear} onClick={() => setYear(year + 1)} />
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {cells.map((cell) => (
            <Cell key={cell.month} cell={cell} selected={cell.month === month} current={current} />
          ))}
        </div>
        <p className="text-muted-foreground text-center text-[13px]">{t("footnote")}</p>
        {month !== current && (
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
