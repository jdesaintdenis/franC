"use client";

import { ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { formatMonthLabel, formatShortMonthLabel } from "@/lib/dashboard/month";
import { formatCompactCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { yearHref } from "./hrefs";

export interface PeriodMonth {
  month: string;
  spentCents: number;
  future: boolean;
}

const CELL = "flex min-h-14 flex-col items-center justify-center rounded-lg px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** The period of "Where the money went": a button with the current choice that opens the whole year and its twelve months. */
export function PeriodSheet({
  year,
  currentYear,
  selected,
  months,
  yearSpentCents,
}: {
  year: number;
  currentYear: number;
  /** "year" or "YYYY-MM". */
  selected: string;
  months: PeriodMonth[];
  yearSpentCents: number;
}) {
  const locale = useLocale();
  const t = useTranslations("year.flow");
  const link = (flow: string | null) => yearHref({ year: year === currentYear ? null : year, flow });
  return (
    <Sheet>
      <SheetTrigger
        aria-haspopup="dialog"
        className="hover:bg-muted focus-visible:ring-ring/50 -my-3 flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-bold outline-none focus-visible:ring-[3px]"
      >
        {selected === "year" ? t("wholeYear") : formatMonthLabel(selected, locale)}
        <ChevronDown className="text-muted-foreground size-3" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent title={t("period")} description={t("periodDescription")} className="theme-50f">
        <div className="grid grid-cols-3 gap-2.5">
          <SheetClose asChild>
            <Link
              href={link(null)}
              scroll={false}
              aria-current={selected === "year" ? "true" : undefined}
              className={cn(CELL, "col-span-3", selected === "year" ? "bg-primary text-primary-foreground" : "bg-secondary")}
            >
              <span className="font-semibold">{t("wholeYear")}</span>
              <span className="text-xs tabular-nums opacity-85">{formatCompactCents(yearSpentCents, locale)}</span>
            </Link>
          </SheetClose>
          {months.map((m) =>
            m.future ? (
              <span key={m.month} role="link" aria-disabled="true" aria-label={formatMonthLabel(m.month, locale)} className={cn(CELL, "bg-secondary opacity-35")}>
                <span className="font-semibold">{formatShortMonthLabel(m.month, locale)}</span>
              </span>
            ) : (
              <SheetClose asChild key={m.month}>
                <Link
                  href={link(m.month)}
                  scroll={false}
                  aria-current={selected === m.month ? "true" : undefined}
                  aria-label={formatMonthLabel(m.month, locale)}
                  className={cn(CELL, selected === m.month ? "bg-primary text-primary-foreground" : "bg-secondary")}
                >
                  <span className="font-semibold">{formatShortMonthLabel(m.month, locale)}</span>
                  <span className="text-xs tabular-nums opacity-85">{formatCompactCents(m.spentCents, locale)}</span>
                </Link>
              </SheetClose>
            ),
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
