import Link from "next/link";
import { Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { chargeTotals, isChargesOnly } from "@/lib/budgets/charges";
import type { BudgetItem, BudgetOverview } from "@/lib/budgets/progress";
import { CATEGORY_PATH_SEPARATOR } from "@/lib/categorize/hierarchy";
import { categoryDrillDownHref } from "@/lib/dashboard/month";
import { homeBudgets } from "@/lib/dashboard/home-lists";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { BudgetGaugeRowContent, GAUGE_ROW_CLASS } from "./budget-gauge-row";
import { ChargesOnlyFold } from "./charges-only-fold";

/**
 * The month's budgets as blocks: name, spent of budget, a ten-block gauge (payments, other spending,
 * payments due) with today's pace tick, a big percentage and what is left to spend.
 */
export function HomeBudgets({
  overview,
  month,
  pace,
  max,
  showCharges,
  foldChargesOnly,
  testId = "home-budgets",
}: {
  overview: BudgetOverview;
  month: string;
  /** Only the month in progress has a pace; a finished month shows its final state. */
  pace?: { day: number; daysInMonth: number };
  /** Rows shown (Home cuts the list; the Budget page passes Infinity). */
  max?: number;
  /** One line per regular payment under each gauge (the Budget page). */
  showCharges?: boolean;
  /** Budgets the regular payments fill are folded under a link instead of dropped (the Budget page). */
  foldChargesOnly?: boolean;
  testId?: string;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard.budgets");
  const { shown } = homeBudgets(overview, max);
  const folded = foldChargesOnly ? overview.items.filter((item) => isChargesOnly(item, chargeTotals(item.charges ?? []))) : [];
  const hasCharges = [...shown, ...folded].some((item) => (item.charges ?? []).length > 0);

  const row = (entry: BudgetItem) => {
    const name = entry.parentName ? `${entry.parentName}${CATEGORY_PATH_SEPARATOR}${entry.name}` : entry.name;
    return (
      <li key={entry.categoryId}>
        <Link
          href={categoryDrillDownHref(month, entry.categoryId, null)}
          className={cn(
            GAUGE_ROW_CLASS,
            "focus-visible:ring-ring/50 -mx-1 rounded-md px-1 py-3 outline-none focus-visible:ring-[3px]",
          )}
        >
          <BudgetGaugeRowContent entry={entry} name={name} pace={pace} showCharges={showCharges} />
        </Link>
      </li>
    );
  };

  const foldTotals = folded.reduce(
    (sum, item) => {
      const totals = chargeTotals(item.charges ?? []);
      return { total: sum.total + totals.paidCents + totals.dueCents, due: sum.due + totals.dueCents };
    },
    { total: 0, due: 0 },
  );

  return (
    <div className="flex flex-col gap-2">
      <ul data-testid={testId} className="divide-border -my-1 divide-y">
        {shown.map(row)}
      </ul>
      {folded.length > 0 && (
        <ChargesOnlyFold
          count={folded.length}
          summary={
            foldTotals.due > 0
              ? t("chargesOnlySummary", { total: formatCents(foldTotals.total, locale), due: formatCents(foldTotals.due, locale) })
              : t("chargesOnlyAllPaid", { total: formatCents(foldTotals.total, locale) })
          }
        >
          <ul className="divide-border -my-1 divide-y">{folded.map(row)}</ul>
        </ChargesOnlyFold>
      )}
      <p className="text-muted-foreground text-[11px]">
        {pace ? (hasCharges ? t("legendCharges") : t("legend")) : hasCharges ? t("legendPastCharges") : t("legendPast")}
      </p>
    </div>
  );
}

/** Shown when nobody has set a budget yet but there are categories to budget. */
export function HomeBudgetsPrompt() {
  const t = useTranslations("dashboard.budgets");
  return (
    <Link
      href="/settings/budgets?add=1"
      className="focus-visible:ring-ring/50 -m-1 flex min-h-11 items-center gap-3 rounded-md p-1 outline-none focus-visible:ring-[3px]"
    >
      <Wallet aria-hidden="true" className="text-primary size-5 shrink-0" />
      <span className="font-medium">{t("setUp")}</span>
    </Link>
  );
}
