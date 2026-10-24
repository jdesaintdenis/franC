import { ArrowLeftRight, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";

import type { BudgetVerdict } from "@/lib/budgets/verdict";
import { addMonths, formatMonthName, inSentence } from "@/lib/dashboard/month";
import type { MonthBar } from "@/lib/dashboard/month-bars";
import { formatShortDay } from "@/lib/format-date";
import { formatCents, formatSignedPercent, formatSignedWholeCents, formatWholeCents } from "@/lib/money";

import { MonthBars } from "./month-bars";

const bold = (chunks: ReactNode) => <b className="text-foreground font-bold">{chunks}</b>;

/**
 * "Le mois": what was spent against what is planned, income and result, the months as bars to jump
 * between, and a one-line verdict on the budgets. Everything here is about the selected month.
 */
export function MonthCard({
  month,
  current,
  today,
  pace,
  hasSpending,
  spentCents,
  incomeCents,
  netCents,
  plannedCents,
  outsideCents,
  incomeDue,
  previousSpentCents,
  bars,
  barScale,
  verdict,
  compareHref,
}: {
  month: string;
  current: string;
  today: string;
  /** Present for the month in progress only. */
  pace?: { day: number; daysInMonth: number };
  hasSpending: boolean;
  spentCents: number;
  incomeCents: number;
  netCents: number;
  plannedCents: number;
  /** Spending no budget and no regular payment covers: part of the spent amount, never of the plan. */
  outsideCents: number;
  incomeDue: { cents: number; date: string } | null;
  previousSpentCents: number | null;
  bars: MonthBar[];
  barScale: number;
  verdict: BudgetVerdict;
  /** The Compare page for this month; the link shows only when the month has spending. */
  compareHref?: string;
}) {
  const locale = useLocale();
  const t = useTranslations("plan.month");
  const totals = useTranslations("dashboard.totals");
  const money = (cents: number) => formatCents(cents, locale);
  const remaining = plannedCents - spentCents;
  const isCurrent = pace !== undefined;

  const sub: ReactNode[] = [];
  if (hasSpending && plannedCents > 0) {
    sub.push(<span key="planned">{t("plannedOf", { amount: money(plannedCents) })}</span>);
    if (outsideCents > 0) {
      sub.push(
        <span key="outside" data-testid="month-outside">
          {t("outsideBudget", { amount: money(outsideCents) })}
        </span>,
      );
    }
    sub.push(
      remaining >= 0 ? (
        <span key="left" className="text-positive">
          {isCurrent ? t("remaining", { amount: money(remaining) }) : t("margin", { amount: money(remaining) })}
        </span>
      ) : (
        <span key="over" className="text-warning">
          {t("overPlanned", { amount: money(-remaining) })}
        </span>
      ),
    );
  }
  if (hasSpending && pace) sub.push(<span key="day">{t("day", { day: pace.day, total: pace.daysInMonth })}</span>);
  if (hasSpending && !isCurrent && previousSpentCents !== null && previousSpentCents > 0) {
    const ratio = (spentCents - previousSpentCents) / previousSpentCents;
    sub.push(
      <span key="vs" className={ratio < 0 ? "text-positive" : ratio > 0 ? "text-warning" : undefined}>
        {t("vsPrevious", { pct: formatSignedPercent(ratio, locale), month: inSentence(formatMonthName(addMonths(month, -1), locale), locale) })}
      </span>,
    );
  }

  const income: ReactNode[] = [];
  if (hasSpending || incomeCents > 0) income.push(<span key="income">{t("income", { amount: money(incomeCents) })}</span>);
  if (isCurrent && incomeDue) {
    income.push(
      <span key="due" className="text-positive">
        {totals("incomeDue", { amount: formatSignedWholeCents(incomeDue.cents, locale), date: formatShortDay(incomeDue.date, today, locale) })}
      </span>,
    );
  }
  if (!isCurrent && hasSpending) {
    income.push(
      <span key="net" className={netCents > 0 ? "text-positive" : netCents < 0 ? "text-warning" : undefined}>
        {t.rich("net", { amount: formatSignedWholeCents(netCents, locale), b: bold })}
      </span>,
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-[15px]" data-testid="month-spent">
          {hasSpending
            ? t.rich("spent", {
                amount: formatWholeCents(spentCents, locale),
                b: (chunks) => <b className="text-foreground text-[28px] font-extrabold tabular-nums">{chunks}</b>,
              })
            : t("noSpending", { month: inSentence(formatMonthName(month, locale), locale) })}
        </p>
        {sub.length > 0 && <Line parts={sub} />}
        {income.length > 0 && <Line parts={income} />}
      </div>
      <MonthBars bars={bars} current={current} plannedCents={plannedCents} scaleCents={barScale} />
      <p className="text-muted-foreground text-[11px]">
        {t("chartLegend")}
        {bars.some((b) => b.kind === "next") && t("chartLegendNext")}
      </p>
      {verdict.kind !== "none" && (
        <p className="border-border border-t pt-3 text-[15px]" data-testid="budget-verdict">
          {verdict.kind === "current"
            ? t.rich("verdictCurrent", { left: formatWholeCents(verdict.leftCents, locale), budgeted: formatWholeCents(verdict.budgetedCents, locale), days: verdict.daysLeft, b: bold })
            : verdict.kind === "pastAllKept"
              ? t.rich("verdictAllKept", { b: bold })
              : t.rich("verdictPast", { kept: verdict.kept, total: verdict.total, over: formatWholeCents(verdict.overCents, locale), b: bold })}
        </p>
      )}
      {compareHref && hasSpending && (
        <Link
          href={compareHref}
          className="border-border text-primary focus-visible:ring-ring/50 -mb-1 flex min-h-12 items-center gap-2.5 border-t pt-3 text-[15px] font-semibold outline-none focus-visible:ring-[3px]"
        >
          <ArrowLeftRight className="size-[18px]" aria-hidden="true" />
          <span className="flex-1">{t("compareLink")}</span>
          <ChevronRight className="size-[18px]" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/** Small faded line whose parts are separated by " · ". */
function Line({ parts }: { parts: ReactNode[] }) {
  return (
    <p className="text-muted-foreground text-[13px] tabular-nums">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {part}
        </span>
      ))}
    </p>
  );
}
