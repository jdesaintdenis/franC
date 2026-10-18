import { TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { formattingLocale } from "@/i18n/config";
import { formatMonthName, monthRange } from "@/lib/dashboard/month";
import { formatShortDay } from "@/lib/format-date";
import { formatCents, formatFrancsNumber, formatSignedCents, formatWholeCents } from "@/lib/money";
import type { SafeToSpendResult } from "@/lib/safe-to-spend/compute";
import { monthProgress, perDayCents, showsNextMonth } from "@/lib/safe-to-spend/per-day";
import type { PaceSeries } from "@/lib/safe-to-spend/pace-series";
import { cn } from "@/lib/utils";

import { PaceChart } from "./home/pace-chart";
import { SafeToSpendBreakdown, settingsLink } from "./safe-to-spend-breakdown";
import { SafeToSpendSheet } from "./safe-to-spend-sheet";

/** Shown instead of the hero when no counted account has a starting balance but another one does. */
export function SafeToSpendPrompt() {
  const t = useTranslations("dashboard.safeToSpend");
  return (
    <p className="text-muted-foreground text-sm">
      {t.rich("prompt", { link: settingsLink("/accounts") })}
    </p>
  );
}

/**
 * What is left to spend until the end of the month, framed like a banknote's value panel (50 F look,
 * SPEC §72): the engraved amount, its worth in old francs, the pace per remaining day and the
 * month's spending chart, with the arithmetic in a sheet. The amber line, never red, flags a shortfall.
 */
export function SafeToSpendHero({
  result,
  today,
  nextMonth,
  pace,
}: {
  result: SafeToSpendResult;
  today: string;
  /** Next month's forecast net over all accounts; only read from the 28th on. */
  nextMonth: { month: string; netCents: number };
  pace: PaceSeries;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard.safeToSpend");
  const date = formatShortDay(result.monthEnd, today, locale);
  const negative = result.safeCents < 0;
  const perDay = perDayCents(result.safeCents, today);
  const { day, daysInMonth } = monthProgress(today);
  const names = new Intl.ListFormat(formattingLocale(locale), { style: "long", type: "conjunction" }).format(
    result.missingBalanceAccounts,
  );
  const strong = (chunks: React.ReactNode) => <strong className="text-foreground font-bold">{chunks}</strong>;
  const range = monthRange(today.slice(0, 7));

  return (
    <section
      aria-labelledby="safe-to-spend-heading"
      data-testid="safe-to-spend"
      className="hero-50f flex flex-col gap-2 rounded-lg p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id="safe-to-spend-heading" className="text-muted-foreground text-[13px] font-semibold">
          {t("until", { date })}
        </h3>
        <span className="bg-secondary rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap">{t("dayChip", { day, total: daysInMonth })}</span>
      </div>
      {/* The francs line is right-aligned with the euro amount and never wider than it. */}
      <div className="flex max-w-full flex-col items-end self-start">
        <p
          data-testid="safe-to-spend-amount"
          className={cn(
            "font-engraved text-[54px] leading-none font-bold tracking-tight [font-variant-numeric:lining-nums_tabular-nums]",
            negative ? "text-warning" : "text-sand",
          )}
        >
          {formatWholeCents(result.safeCents, locale)}
        </p>
        <p data-testid="francs-amount" className="text-muted-foreground text-xs tabular-nums">
          {t("francs", { amount: formatFrancsNumber(result.safeCents, locale) })}
        </p>
      </div>
      {negative && (
        <p className="text-warning flex items-start gap-2 text-sm font-semibold">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">{t("short", { amount: formatCents(-result.safeCents, locale), date })}</span>
        </p>
      )}
      {result.safeCents === 0 && <p className="text-muted-foreground text-sm">{t("nothing", { date })}</p>}
      {perDay && (
        <p className="text-muted-foreground text-[15px]">
          {t.rich(perDay.daysLeft === 1 ? "perDayLast" : "perDay", {
            amount: formatWholeCents(perDay.perDayCents, locale),
            days: perDay.daysLeft,
            strong,
          })}
        </p>
      )}
      <PaceChart
        series={pace}
        startLabel={formatShortDay(range.from, today, locale)}
        endLabel={formatShortDay(range.to, today, locale)}
        todayLabel={t("chartToday")}
        plannedLabel={t("chartPlanned")}
      />
      <div className="flex items-center justify-end">
        <SafeToSpendSheet triggerLabel={t("howWorked")} title={t("breakdownTitle")} description={t("breakdownDescription", { date })}>
          <SafeToSpendBreakdown result={result} today={today} />
        </SafeToSpendSheet>
      </div>
      {showsNextMonth(today) && (
        <Link
          href="/budget/next-month"
          className="text-muted-foreground -mx-1 block rounded-md px-1 py-2.5 text-sm underline-offset-2 hover:underline"
        >
          {t.rich("nextMonth", {
            month: formatMonthName(nextMonth.month, locale),
            value: formatSignedCents(nextMonth.netCents, locale),
            amount: (chunks) => <span className="text-foreground font-bold tabular-nums">{chunks}</span>,
          })}
        </Link>
      )}
      {result.asOf !== null && result.asOf !== today && (
        <p className="text-muted-foreground text-xs">{t("asOf", { date: formatShortDay(result.asOf, today, locale) })}</p>
      )}
      {result.missingBalanceAccounts.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {t.rich("missing", {
            names,
            count: result.missingBalanceAccounts.length,
            link: (chunks) => (
              <Link href="/accounts" className="text-foreground underline underline-offset-2">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
    </section>
  );
}
