import { useLocale, useTranslations } from "next-intl";

import { CategoryMarker } from "@/components/category-marker";
import { chargeTotals, leftToSpend } from "@/lib/budgets/charges";
import type { BudgetEntry } from "@/lib/budgets/progress";
import { categoryDisplayColor } from "@/lib/category-color";
import { budgetDetail, budgetPercent, gaugeSegments, restPaceTickPercent } from "@/lib/dashboard/home-lists";
import { formatCents, formatPercent } from "@/lib/money";
import { cn } from "@/lib/utils";

import { BlockGauge } from "./block-gauge";
import { BudgetChargeLines } from "./budget-charge-lines";

/** The grid every ten-block row shares: tile, name and detail, big figure, then the gauge under the text. */
export const GAUGE_ROW_CLASS = "grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5";

/**
 * What a budget row shows: tile, name, "x sur y" with the amber over / fast-pace note and the
 * payments still due, a big percentage, the gauge (paid payments, other spending, payments due) with
 * today's pace tick on the rest, and what is left to spend. Shared by Home, the Budget page and Settings > Budgets.
 */
export function BudgetGaugeRowContent({
  entry,
  name,
  pace,
  suffix,
  showCharges,
}: {
  entry: BudgetEntry;
  name: string;
  /** The month in progress only: a finished month has no pace and nothing left to spend. */
  pace?: { day: number; daysInMonth: number };
  /** Muted text after the detail line, such as "Reste reporté". */
  suffix?: string;
  /** One line per regular payment under the gauge (the Budget page). */
  showCharges?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard.budgets");
  const hot = entry.status === "over" || entry.onPace;
  const percent = budgetPercent(entry);
  const totals = chargeTotals(entry.charges ?? []);
  const paceAt = pace ? restPaceTickPercent(pace.day, pace.daysInMonth, entry, totals) : undefined;
  const left = pace && entry.status !== "over" ? leftToSpend(entry, totals) : null;
  return (
    <>
      <span
        aria-hidden="true"
        className="row-span-2 flex size-8 items-center justify-center rounded-[10px] text-lg"
        style={{ backgroundColor: `color-mix(in srgb, ${categoryDisplayColor(entry.color)} 18%, transparent)` }}
      >
        <CategoryMarker icon={entry.icon} color={entry.color} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">{name}</span>
        <span className="text-muted-foreground text-xs">
          <BudgetDetailText entry={entry} />
          {suffix}
          {totals.dueCents > 0 && <span className="text-sand whitespace-nowrap">{` · ${t("dueShort", { amount: formatCents(totals.dueCents, locale) })}`}</span>}
          {entry.status === "over" ? (
            <span className="text-warning">{` · ${t("overShort", { amount: formatCents(entry.overCents, locale) })}`}</span>
          ) : (
            entry.onPace && <span className="text-warning">{` · ${t("fastPace")}`}</span>
          )}
        </span>
      </span>
      <span className={cn("row-span-2 text-[22px] font-extrabold tabular-nums", hot && "text-warning")}>
        {formatPercent(percent, locale)}
      </span>
      <BlockGauge
        percent={percent}
        tone={hot ? "warning" : "accent"}
        paceAt={paceAt}
        segments={totals.paidCents + totals.dueCents > 0 ? gaugeSegments(entry, totals) : undefined}
      />
      {left !== null && totals.paidCents + totals.dueCents > 0 && <LeftToSpend cents={left} />}
      {showCharges && <BudgetChargeLines charges={entry.charges ?? []} />}
    </>
  );
}

/** What the month still allows once the payments due are set aside (only drawn for budgets with payments). */
function LeftToSpend({ cents }: { cents: number }) {
  const locale = useLocale();
  const t = useTranslations("dashboard.budgets");
  return (
    <span className={cn("col-start-2 -mt-0.5 text-[11px]", cents < 0 ? "text-warning" : "text-muted-foreground")}>
      {cents < 0
        ? t("tooMuch", { amount: formatCents(-cents, locale) })
        : cents === 0
          ? t("nothingLeft")
          : t.rich("leftToSpend", { amount: formatCents(cents, locale), b: (chunks) => <b className="text-foreground font-bold">{chunks}</b> })}
    </span>
  );
}

/** "x sur y", or the rollover delay in words: never a negative "sur" (SPEC §74 J). */
export function BudgetDetailText({ entry }: { entry: BudgetEntry }) {
  const locale = useLocale();
  const t = useTranslations("dashboard.budgets");
  const detail = budgetDetail(entry);
  const money = (cents: number) => formatCents(cents, locale);
  if (detail.kind === "behind") return t("behind", { spent: money(detail.spentCents), carry: money(detail.carryCents) });
  if (detail.kind === "ofBehind") {
    return t("ofBehind", { spent: money(detail.spentCents), budget: money(detail.availableCents), carry: money(detail.carryCents) });
  }
  return t("spentOf", { spent: money(detail.spentCents), budget: money(detail.availableCents) });
}
