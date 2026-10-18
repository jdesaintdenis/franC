import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { addMonths, dashboardHref } from "@/lib/dashboard/month";
import type { MonthHistoryRow } from "@/lib/dashboard/month-picker";
import { cn } from "@/lib/utils";

import { MonthPickerSheet } from "../month-picker-sheet";

const ARROW =
  "bg-secondary hover:bg-muted focus-visible:ring-ring/50 flex size-11 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-[3px]";

/**
 * ‹ Juillet 2026 ▾ › beside the page title. The arrows are plain links, so stepping works without
 * JS; the name opens the month grid, to jump far in one gesture. The next arrow stops at the
 * current month.
 */
export function MonthTitle({ month, current, history }: { month: string; current: string; history: MonthHistoryRow[] }) {
  const t = useTranslations("dashboard.monthSelector");
  const atCurrent = month >= current;
  const next = addMonths(month, 1);
  return (
    <div className="flex items-center gap-1">
      <Link href={dashboardHref({ month: addMonths(month, -1) })} aria-label={t("previous")} className={ARROW}>
        <ChevronLeft className="size-5" aria-hidden="true" />
      </Link>
      <MonthPickerSheet month={month} current={current} history={history} />
      {atCurrent ? (
        <span aria-disabled="true" aria-label={t("next")} role="link" className={cn(ARROW, "opacity-35")}>
          <ChevronRight className="size-5" aria-hidden="true" />
        </span>
      ) : (
        <Link href={dashboardHref({ month: next === current ? null : next })} aria-label={t("next")} className={ARROW}>
          <ChevronRight className="size-5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
