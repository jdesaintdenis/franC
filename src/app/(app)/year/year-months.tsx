import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { dashboardHref, formatMonthName } from "@/lib/dashboard/month";
import { formatSignedWholeCents, formatWholeCents } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface YearMonthRow {
  month: string;
  incomeCents: number;
  spentCents: number;
  /** Money moved to Savings accounts minus taken out; shown only with `showSaved`. */
  savedCents: number;
  current: boolean;
}

/** One row per month with data, newest first: what came in and went out, and the net on the right. */
export function YearMonths({ rows, showSaved }: { rows: YearMonthRow[]; showSaved: boolean }) {
  const locale = useLocale();
  const t = useTranslations("year.monthly");
  return (
    <ul className="divide-border divide-y" data-testid="year-months">
      {rows.map((r) => {
        const net = r.incomeCents - r.spentCents;
        const values = { income: formatWholeCents(r.incomeCents, locale), spent: formatWholeCents(r.spentCents, locale), saved: formatSignedWholeCents(r.savedCents, locale) };
        return (
          <li key={r.month}>
            <Link
              href={dashboardHref({ month: r.month })}
              className="hover:bg-muted/60 focus-visible:ring-ring/50 grid min-h-14 grid-cols-[1fr_auto] items-center gap-x-3 px-3.5 py-2 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
            >
              <span className="flex items-center gap-2 font-semibold">
                {formatMonthName(r.month, locale)}
                {r.current && <span className="bg-secondary rounded-full px-2.5 py-0.5 text-xs font-bold">{t("inProgress")}</span>}
              </span>
              <span className={cn("row-span-2 font-bold tabular-nums", net > 0 && "text-positive")}>{formatSignedWholeCents(net, locale)}</span>
              <span className="text-muted-foreground text-xs tabular-nums">{showSaved ? t("rowSaved", values) : t("row", values)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
