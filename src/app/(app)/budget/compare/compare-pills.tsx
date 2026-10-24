import { ArrowLeftRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import type { ComparedMonths } from "@/lib/compare/months";
import { compareHref } from "@/lib/compare/months";
import type { MonthHistoryRow } from "@/lib/dashboard/month-picker";

import { MonthPickerSheet } from "../../month-picker-sheet";

/** Month A · swap · month B. Each pill opens the month grid for its side; swap is a plain link. */
export function ComparePills({ months, current, history }: { months: ComparedMonths; current: string; history: MonthHistoryRow[] }) {
  const t = useTranslations("plan.compare");
  return (
    <div className="flex items-center gap-2 pb-1">
      <MonthPickerSheet month={months.a} current={current} history={history} compare={{ ...months, side: "a" }} />
      <Link
        href={compareHref({ a: months.b, b: months.a })}
        aria-label={t("swap")}
        data-testid="compare-swap"
        className="text-muted-foreground hover:bg-muted focus-visible:ring-ring/50 flex size-10 shrink-0 items-center justify-center rounded-full border outline-none focus-visible:ring-[3px]"
      >
        <ArrowLeftRight className="size-[18px]" aria-hidden="true" />
      </Link>
      <MonthPickerSheet month={months.b} current={current} history={history} compare={{ ...months, side: "b" }} />
    </div>
  );
}
