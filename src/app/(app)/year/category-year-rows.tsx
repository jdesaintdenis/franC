import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { CategoryTile } from "@/components/category-tile";
import { categoryDisplayColor } from "@/lib/category-color";
import { formatMonthName } from "@/lib/dashboard/month";
import { formatWholeCents } from "@/lib/money";
import type { CategoryMatrix } from "@/lib/year/averages";

import { spendingHref } from "./hrefs";

/** Twelve tiny bars, one per month; the priciest month(s) take the category's colour. Decorative. */
function Sparkline({ values, biggest, color, futureFrom, months }: { values: number[]; biggest: number[]; color: string; futureFrom: string | null; months: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <span aria-hidden="true" className="col-span-2 col-start-2 grid h-[22px] grid-cols-12 items-end gap-0.5">
      {values.map((v, i) =>
        futureFrom !== null && months[i] >= futureFrom ? (
          <i key={months[i]} className="border-border h-0 border-b border-dashed" />
        ) : (
          <i
            key={months[i]}
            className="bg-primary/28 block rounded-[1px]"
            style={{ height: `${Math.max(8, (v / max) * 100)}%`, ...(biggest.includes(i) ? { backgroundColor: color } : {}) }}
          />
        ),
      )}
    </span>
  );
}

/** One row per top-level category for the year: total, monthly average and the shape of its months. */
export function CategoryYearRows({
  year,
  months,
  futureFrom,
  matrix,
  coveredCount,
}: {
  year: number;
  months: string[];
  /** First month after today ("YYYY-MM"), or null for a past year. */
  futureFrom: string | null;
  matrix: CategoryMatrix;
  coveredCount: number;
}) {
  const locale = useLocale();
  const t = useTranslations("year.categories");
  const glossary = useTranslations("common.glossary");
  return (
    <>
      <ul className="divide-border divide-y" data-testid="year-categories">
        {matrix.rows.map((row) => {
          const top = row.biggestMonthIndexes[0];
          return (
            <li key={row.categoryId ?? "none"}>
              <Link
                href={spendingHref({ year }, row.categoryId)}
                className="hover:bg-muted/60 focus-visible:ring-ring/50 grid grid-cols-[32px_1fr_auto] items-center gap-x-2.5 gap-y-1.5 px-3.5 py-2.5 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
              >
                <CategoryTile icon={row.icon} color={row.color} />
                <span className="truncate font-semibold">{row.categoryId ? row.name : glossary("uncategorized")}</span>
                <span className="flex flex-col items-end">
                  <span className="font-bold tabular-nums">{formatWholeCents(row.totalCents, locale)}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">{t("perMonth", { amount: formatWholeCents(row.averageCents, locale) })}</span>
                </span>
                <Sparkline values={row.byMonth} biggest={row.biggestMonthIndexes} color={categoryDisplayColor(row.color)} futureFrom={futureFrom} months={months} />
                {top !== undefined && <span className="sr-only">{t("biggest", { month: formatMonthName(months[top], locale) })}</span>}
              </Link>
            </li>
          );
        })}
        <li>
          <Link
            href={spendingHref({ year }, undefined)}
            className="hover:bg-muted/60 focus-visible:ring-ring/50 flex min-h-14 items-center justify-between gap-3 px-3.5 py-2 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
          >
            <span className="font-bold">{t("total")}</span>
            <span className="flex flex-col items-end">
              <span className="font-bold tabular-nums">{formatWholeCents(matrix.totals.totalCents, locale)}</span>
              <span className="text-muted-foreground text-xs tabular-nums">{t("perMonth", { amount: formatWholeCents(matrix.totals.averageCents, locale) })}</span>
            </span>
          </Link>
        </li>
      </ul>
      <p className="text-muted-foreground border-border border-t px-3.5 py-2.5 text-xs">{t("averageNote", { count: coveredCount })}</p>
    </>
  );
}
