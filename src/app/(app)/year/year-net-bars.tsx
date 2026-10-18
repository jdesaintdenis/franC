import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { dashboardHref, formatMonthLabel, formatShortMonthLabel } from "@/lib/dashboard/month";
import { formatSignedWholeCents } from "@/lib/money";
import { netBarScale } from "@/lib/year/net-bars";

export interface NetBarMonth {
  month: string;
  netCents: number;
  /** A month still to come, or one without a transaction: label only. */
  empty: boolean;
  current: boolean;
}

const BARS_HEIGHT = 132;
const LABEL_HEIGHT = 18;
const HATCH = "repeating-linear-gradient(135deg, var(--secondary) 0 4px, var(--gauge-off) 4px 8px)";

/**
 * The net of each month: up from an axis when the month saved, down from it when it cost more
 * than it brought. Plain HTML, one link per month, so it works without JS and never scrolls sideways.
 */
export function YearNetBars({ months, bestMonth }: { months: NetBarMonth[]; bestMonth: string | null }) {
  const locale = useLocale();
  const t = useTranslations("year.monthly");
  const { posMax, negMax, axisPct } = netBarScale(months.filter((m) => !m.empty).map((m) => m.netCents));
  return (
    <div className="flex flex-col gap-2" data-testid="year-net-bars">
      <div className="relative" style={{ height: BARS_HEIGHT + LABEL_HEIGHT }}>
        <div aria-hidden="true" className="border-border absolute inset-x-0 border-t" style={{ top: `${(axisPct / 100) * BARS_HEIGHT}px` }} />
        <div className="grid h-full grid-cols-12 gap-1">
          {months.map((m) => {
            const label = formatShortMonthLabel(m.month, locale);
            const up = m.netCents >= 0;
            const share = up ? (posMax === 0 ? 0 : m.netCents / posMax) * axisPct : (negMax === 0 ? 0 : -m.netCents / negMax) * (100 - axisPct);
            const heightPx = m.empty ? 0 : Math.max(2, (share / 100) * BARS_HEIGHT);
            const color = m.current ? undefined : up ? (m.month === bestMonth ? "bg-positive" : "bg-primary/35") : "bg-warning/55";
            const bar = (
              <span aria-hidden="true" className="relative block" style={{ height: BARS_HEIGHT }}>
                {heightPx > 0 && (
                  <span
                    className={`absolute inset-x-0 ${color ?? "bg-secondary"} ${up ? "rounded-t-[3px]" : "rounded-b-[3px]"}`}
                    style={{
                      height: heightPx,
                      [up ? "bottom" : "top"]: `${up ? BARS_HEIGHT - (axisPct / 100) * BARS_HEIGHT : (axisPct / 100) * BARS_HEIGHT}px`,
                      ...(m.current ? { backgroundImage: HATCH } : {}),
                    }}
                  />
                )}
              </span>
            );
            const caption = <span className="text-muted-foreground block h-[18px] truncate text-center text-[10px]">{label}</span>;
            return m.empty ? (
              <span key={m.month} aria-hidden="true" className="min-w-0">
                {bar}
                {caption}
              </span>
            ) : (
              <Link
                key={m.month}
                href={dashboardHref({ month: m.month })}
                aria-label={t("barLabel", { month: formatMonthLabel(m.month, locale), amount: formatSignedWholeCents(m.netCents, locale) })}
                className="focus-visible:ring-ring/50 min-w-0 rounded-sm outline-none focus-visible:ring-[3px]"
              >
                {bar}
                {caption}
              </Link>
            );
          })}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">{bestMonth ? t("legend") : t("legendNoBest")}</p>
    </div>
  );
}
