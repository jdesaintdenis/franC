import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { dashboardHref, formatMonthLabel, formatShortMonthLabel } from "@/lib/dashboard/month";
import type { MonthBar } from "@/lib/dashboard/month-bars";
import { formatWholeCents } from "@/lib/money";
import { cn } from "@/lib/utils";

const BARS_HEIGHT = 114;
const LABEL_HEIGHT = 18;

/** The bar's look: ink wash, periwinkle when selected, hatched while the month is in progress, outline for next month. */
function barStyle(bar: MonthBar) {
  if (bar.kind === "next") return { className: "border-muted-foreground border-[1.5px] border-b-0 border-dashed bg-transparent" };
  if (bar.selected) return { className: "bg-primary" };
  if (bar.kind === "current") {
    return { className: "bg-secondary", style: { backgroundImage: "repeating-linear-gradient(135deg, var(--secondary) 0 4px, var(--gauge-off) 4px 8px)" } };
  }
  return { className: "bg-secondary" };
}

/**
 * Spending month by month, with the selected month's planned amount as a dashed line. Every bar is a
 * link to its month, so it works without JS. Plain HTML: nine or ten columns do not need a chart library.
 */
export function MonthBars({
  bars,
  current,
  plannedCents,
  scaleCents,
}: {
  bars: MonthBar[];
  current: string;
  plannedCents: number;
  scaleCents: number;
}) {
  const locale = useLocale();
  const t = useTranslations("plan.month");
  const plannedAt = Math.min(100, (plannedCents / scaleCents) * 100);

  return (
    <div className="relative" style={{ height: BARS_HEIGHT + LABEL_HEIGHT }} data-testid="budget-month-bars">
      {plannedCents > 0 && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0" style={{ height: BARS_HEIGHT }}>
          <div className="border-foreground/45 absolute inset-x-0 border-t-[1.5px] border-dashed" style={{ bottom: `${plannedAt}%` }}>
            <span className="bg-card text-muted-foreground absolute bottom-0.5 left-0 pr-1 text-[10px] tabular-nums">
              {t("plannedLine", { amount: formatWholeCents(plannedCents, locale) })}
            </span>
          </div>
        </div>
      )}
      <ul className="grid h-full gap-1.5" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
        {bars.map((bar) => {
          const { className, style } = barStyle(bar);
          const height = Math.min(100, (bar.spentCents / scaleCents) * 100);
          return (
            <li key={bar.month} className="min-w-0">
              <Link
                href={dashboardHref({ month: bar.month === current ? null : bar.month })}
                aria-label={t("barLabel", { month: formatMonthLabel(bar.month, locale), amount: formatWholeCents(bar.spentCents, locale) })}
                aria-current={bar.selected ? "date" : undefined}
                className="focus-visible:ring-ring/50 flex h-full flex-col rounded-md outline-none focus-visible:ring-[3px]"
              >
                <span className="flex items-end" style={{ height: BARS_HEIGHT }}>
                  <span className={cn("w-full rounded-t-[3px]", className)} style={{ height: `${height}%`, ...style }} />
                </span>
                <span
                  className={cn("flex items-center justify-center truncate text-[10px]", bar.selected ? "text-foreground font-bold" : "text-muted-foreground")}
                  style={{ height: LABEL_HEIGHT }}
                >
                  {formatShortMonthLabel(bar.month, locale)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
