import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";

import { CategoryTile } from "@/components/category-tile";
import type { MonthTotals } from "@/db/queries/dashboard";
import { budgetSharePercent, changeRatio, changeTone, type CategoryComparison, type MonthNames } from "@/lib/compare/months";
import { categoryDrillDownHref } from "@/lib/dashboard/month";
import { formatPercent, formatSignedPercent, formatSignedWholeCents, formatWholeCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import type { BudgetComparison } from "./compare-data";

const TONE = { positive: "text-positive", warning: "text-warning", same: undefined } as const;

/** "−438 €", or "=" when nothing changed. */
function Diff({ cents, higherIsGood = false }: { cents: number; higherIsGood?: boolean }) {
  const locale = useLocale();
  return (
    <span className={cn("font-bold tabular-nums", TONE[changeTone(cents, higherIsGood)])}>{cents === 0 ? "=" : formatSignedWholeCents(cents, locale)}</span>
  );
}

/** The answer in one line, then spending, income and net for both months. */
export function CompareSummary({
  totals,
  names,
  inProgress,
}: {
  totals: { a: MonthTotals; b: MonthTotals };
  names: { a: MonthNames; b: MonthNames };
  /** Name of the compared month still in progress, if any. */
  inProgress: string | null;
}) {
  const locale = useLocale();
  const t = useTranslations("plan.compare");
  const diff = totals.a.spentCents - totals.b.spentCents;
  const ratio = changeRatio(totals.a.spentCents, totals.b.spentCents);
  const tone = TONE[changeTone(diff, false)];
  const bold = (chunks: ReactNode) => <b className={cn("text-[28px] font-extrabold tabular-nums", tone)}>{chunks}</b>;
  const rows = [
    { label: t("spent"), a: totals.a.spentCents, b: totals.b.spentCents, higherIsGood: false, format: formatWholeCents },
    { label: t("income"), a: totals.a.incomeCents, b: totals.b.incomeCents, higherIsGood: true, format: formatWholeCents },
    { label: t("net"), a: totals.a.netCents, b: totals.b.netCents, higherIsGood: true, format: formatSignedWholeCents },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-[15px] leading-snug" data-testid="compare-answer">
        {diff === 0
          ? t("same", { month: names.b.sentence })
          : t.rich(diff < 0 ? "less" : "more", { amount: formatWholeCents(Math.abs(diff), locale), month: names.b.sentence, b: bold })}
        {ratio !== null && <span className={cn("tabular-nums", tone)}>{` (${formatSignedPercent(ratio, locale)})`}</span>}
      </p>
      <table className="w-full text-[15px] tabular-nums">
        <thead>
          <tr className="text-muted-foreground text-xs">
            <td />
            <th scope="col" className="text-primary pb-1 text-right font-bold">
              {names.a.header}
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              {names.b.header}
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              {t("diff")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-border border-t">
              <th scope="row" className="text-muted-foreground py-2.5 pr-2 text-left text-sm font-normal">
                {row.label}
              </th>
              <td className="py-2.5 pl-2 text-right font-bold">{row.format(row.a, locale)}</td>
              <td className="text-muted-foreground py-2.5 pl-2 text-right">{row.format(row.b, locale)}</td>
              <td className="py-2.5 pl-2 text-right text-sm">
                <Diff cents={row.a - row.b} higherIsGood={row.higherIsGood} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {inProgress && <p className="text-muted-foreground text-xs">{t("inProgress", { month: inProgress })}</p>}
    </div>
  );
}

/** "■ sept. ■ juil." beside the categories title. */
export function CompareLegend({ names }: { names: { a: MonthNames; b: MonthNames } }) {
  return (
    <span className="text-muted-foreground flex gap-3 text-xs" aria-hidden="true">
      <span className="flex items-center gap-1.5">
        <i className="bg-primary size-2.5 rounded-[3px]" />
        {names.a.header}
      </span>
      <span className="flex items-center gap-1.5">
        <i className="bg-primary/40 size-2.5 rounded-[3px]" />
        {names.b.header}
      </span>
    </span>
  );
}

function Bar({ cents, maxCents, strong }: { cents: number; maxCents: number; strong: boolean }) {
  const locale = useLocale();
  return (
    <span className="grid grid-cols-[minmax(0,1fr)_4rem] items-center gap-2">
      <span aria-hidden="true" className="bg-gauge-off h-2 overflow-hidden rounded-[4px]">
        <span className={cn("block h-full rounded-[4px]", strong ? "bg-primary" : "bg-primary/40")} style={{ width: `${(cents / maxCents) * 100}%` }} />
      </span>
      <span className={cn("text-right text-[13px] tabular-nums", strong ? "font-semibold" : "text-muted-foreground")}>{formatWholeCents(cents, locale)}</span>
    </span>
  );
}

/** One row per category spent in either month: the change, then both months as bars on one scale. */
export function CompareCategories({
  rows,
  month,
  names,
  uncategorized,
}: {
  rows: CategoryComparison[];
  /** Month A: where a row leads. */
  month: string;
  names: { a: MonthNames; b: MonthNames };
  uncategorized: string;
}) {
  const locale = useLocale();
  const t = useTranslations("plan.compare");
  const maxCents = Math.max(1, ...rows.flatMap((r) => [r.aCents, r.bCents]));
  return (
    <div className="flex flex-col gap-2">
      <ul className="divide-border -my-1 divide-y text-sm">
        {rows.map((row) => {
          const ratio = changeRatio(row.aCents, row.bCents);
          const name = row.name ?? uncategorized;
          return (
            <li key={row.key} data-testid="compare-category">
              <Link
                href={categoryDrillDownHref(month, row.categoryId, null)}
                aria-label={t("rowLabel", {
                  name,
                  amountA: formatWholeCents(row.aCents, locale),
                  monthA: names.a.sentence,
                  amountB: formatWholeCents(row.bCents, locale),
                  monthB: names.b.sentence,
                  diff: row.diffCents === 0 ? "=" : formatSignedWholeCents(row.diffCents, locale),
                })}
                className="focus-visible:ring-ring/50 -mx-1 grid grid-cols-[32px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 rounded-md px-1 py-3 outline-none focus-visible:ring-[3px]"
              >
                <span className="row-span-2">
                  <CategoryTile icon={row.icon} color={row.color} />
                </span>
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className={cn("min-w-0 flex-1 truncate font-semibold", row.name === null && "text-warning")}>{name}</span>
                  <Diff cents={row.diffCents} />
                  <span className="text-muted-foreground w-14 text-right text-xs tabular-nums">
                    {ratio !== null ? formatSignedPercent(ratio, locale) : row.bCents === 0 ? t("new") : ""}
                  </span>
                </span>
                <span className="flex flex-col gap-1">
                  <Bar cents={row.aCents} maxCents={maxCents} strong />
                  <Bar cents={row.bCents} maxCents={maxCents} strong={false} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground border-border border-t pt-2 text-[11px]">{t("categoriesNote", { month: names.a.sentence })}</p>
    </div>
  );
}

/** Share of each budget spent in both months, against today's amount. */
export function CompareBudgets({ budgets }: { budgets: BudgetComparison[] }) {
  const locale = useLocale();
  const t = useTranslations("plan.compare");
  const percent = (cents: number, budgetCents: number) => formatPercent(budgetSharePercent(cents, budgetCents) ?? 0, locale);
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col">
        {budgets.map((row) => (
          <li key={row.categoryId} className="flex items-center gap-2.5 py-2" data-testid="compare-budget">
            <CategoryTile icon={row.icon} color={row.color} />
            <span className="min-w-0 flex-1 truncate font-semibold">{row.parentName ? `${row.parentName} › ${row.name}` : row.name}</span>
            <span className="text-muted-foreground text-[13px] tabular-nums">
              {t.rich("budgetShare", {
                shareA: percent(row.aSpentCents, row.budgetCents),
                shareB: percent(row.bSpentCents, row.budgetCents),
                b: (chunks) => <b className={cn("font-bold", row.aSpentCents > row.budgetCents ? "text-warning" : "text-foreground")}>{chunks}</b>,
              })}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-[11px]">{t("budgetsNote")}</p>
    </div>
  );
}
