"use client";

import { useLocale } from "next-intl";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { axisTick, Y_AXIS_WIDTH } from "@/components/charts/chart-style";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { formatCents, formatCompactCents } from "@/lib/money";

export type LoanCurveKind = "computed" | "estimated" | "real" | "projected";

export interface LoanCurvePoint {
  /** "YYYY-MM-DD" */
  date: string;
  /** Tooltip label, formatted on the server. */
  label: string;
  owedCents: number;
  /** Which stretch of the curve this point closes: computed (deferral), estimated, real or the plan. */
  kind: LoanCurveKind;
}

const LINE = "var(--sand)";
const KINDS: LoanCurveKind[] = ["computed", "estimated", "real", "projected"];

/** Days since 1970-01-01 from "YYYY-MM-DD", by arithmetic only so no time zone can shift the day. */
function epochDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

const yearStart = (year: number) => Math.round(Date.UTC(year, 0, 1) / 86_400_000);

/**
 * Capital owed from the subscription (or the first figure) to the contract's last payment, on a real time axis:
 * the computed deferral is solid, the estimated period one dashed segment, real payments solid, the plan dashed.
 * The vertical scale goes up to the borrowed amount, so the line never looks flat because of the scale.
 * Decorative: the hero says the same.
 */
export function LoanCurve({ data, today, endDate, maxCents }: { data: LoanCurvePoint[]; today: string; endDate: string; maxCents: number }) {
  const locale = useLocale();
  const rows = data.map((p, i) => {
    const next = data[i + 1];
    const row: Record<string, number | string | null> = { ...p, x: epochDay(p.date) };
    // A stretch starts on the last point of the previous one, so the lines join.
    for (const kind of KINDS) row[kind] = p.kind === kind || next?.kind === kind ? p.owedCents : null;
    return row;
  });
  const min = rows[0].x as number;
  const end = Math.max(epochDay(endDate), rows.at(-1)?.x as number);
  const todayX = epochDay(today);

  // One tick per year, thinned to what fits, plus the contract's end so the right edge is dated.
  const firstYear = Number(data[0].date.slice(0, 4));
  const lastYear = Number(endDate.slice(0, 4));
  const step = Math.max(1, Math.ceil((lastYear - firstYear + 1) / 4));
  // Labels need about a fifth of the width each on a phone, and the same year never shows twice.
  const room = (end - min) * 0.18;
  const ticks = [min];
  for (let year = firstYear + 1; year < lastYear; year += step) {
    const x = yearStart(year);
    if (x - ticks[ticks.length - 1] > room && end - x > room) ticks.push(x);
  }
  if (lastYear > firstYear) ticks.push(end);

  const yearOf = (x: number) => String(new Date(x * 86_400_000).getUTCFullYear());
  return (
    <div className="w-full" aria-hidden="true" data-testid="loan-curve">
      <ResponsiveContainer width="100%" height={150}>
        <AreaChart accessibilityLayer={false} data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <XAxis dataKey="x" type="number" domain={[min, end]} padding={{ left: 8, right: 8 }} ticks={ticks} interval={0} tickLine={false} axisLine={false} tickFormatter={yearOf} tick={axisTick()} />
          <YAxis
            width={Y_AXIS_WIDTH + 4}
            domain={[0, maxCents]}
            ticks={[0, maxCents]}
            interval={0}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatCompactCents(Number(value), locale)}
            tick={axisTick(true)}
          />
          {todayX > min && todayX < end && <ReferenceLine x={todayX} stroke="var(--muted-foreground)" strokeDasharray="2 3" strokeOpacity={0.7} />}
          <Tooltip
            content={(props) => {
              const point = props.payload?.[0]?.payload as LoanCurvePoint | undefined;
              if (!point) return null;
              return (
                <ChartTooltip
                  active={props.active}
                  payload={[{ value: point.owedCents, color: LINE }]}
                  formatValue={(value) => formatCents(value, locale)}
                  formatLabel={() => point.label}
                />
              );
            }}
          />
          <Area type="linear" dataKey="computed" stroke={LINE} strokeWidth={2.5} fill={LINE} fillOpacity={0.15} isAnimationActive={false} connectNulls={false} />
          <Area type="linear" dataKey="estimated" stroke={LINE} strokeWidth={2} strokeDasharray="5 4" strokeOpacity={0.5} fill={LINE} fillOpacity={0.05} isAnimationActive={false} connectNulls={false} />
          <Area type="monotone" dataKey="real" stroke={LINE} strokeWidth={2.5} fill={LINE} fillOpacity={0.15} isAnimationActive={false} connectNulls={false} />
          <Area type="monotone" dataKey="projected" stroke={LINE} strokeWidth={2} strokeDasharray="5 4" strokeOpacity={0.8} fill={LINE} fillOpacity={0.06} isAnimationActive={false} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
