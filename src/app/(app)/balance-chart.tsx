"use client";

import { useLocale } from "next-intl";
import { Area, AreaChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { axisTick, CHART_COLORS, Y_AXIS_WIDTH } from "@/components/charts/chart-style";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { formatCents, formatCompactCents } from "@/lib/money";

export interface BalanceChartPoint {
  date: string;
  /** Day of the month ("1".."31"): the axis value. */
  day: string;
  /** Tooltip label, formatted on the server. */
  label: string;
  balanceCents: number;
  /** True after the last known day: drawn dashed. */
  projected: boolean;
}

const LINE = "var(--primary)";

/** Decorative: the card's text carries the same facts (end of month, lowest point). */
export function BalanceChart({
  data,
  thresholdCents,
  lowest,
}: {
  data: BalanceChartPoint[];
  thresholdCents: number;
  /** The lowest point, marked with a dot; `day` is its axis value. */
  lowest?: { day: string; balanceCents: number };
}) {
  const locale = useLocale();
  // Only the two ends of the scale are labelled: enough to read the range, no clutter.
  const values = [...data.map((p) => p.balanceCents), thresholdCents];
  const min = Math.min(...values);
  const max = Math.max(...values);
  // The last real day is in both runs so the solid and dashed lines touch.
  const lastRealIndex = data.findLastIndex((p) => !p.projected);
  const rows = data.map((p, i) => ({
    ...p,
    actualCents: p.projected ? null : p.balanceCents,
    projectedCents: p.projected || i === lastRealIndex ? p.balanceCents : null,
  }));
  // Every 7th day, but not within 4 days of the last one: two labels there would overlap.
  const last = data.length - 1;
  const ticks = data.filter((_, i) => i === last || (i % 7 === 0 && last - i >= 4)).map((p) => p.day);
  return (
    <div className="w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height={150}>
        <AreaChart accessibilityLayer={false} data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="day" ticks={ticks} interval={0} tickLine={false} axisLine={false} tick={axisTick()} />
          <YAxis
            width={Y_AXIS_WIDTH + 4}
            domain={[min, max]}
            ticks={min === max ? [min] : [min, max]}
            interval={0}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatCompactCents(Number(value), locale)}
            tick={axisTick(true)}
          />
          <Tooltip
            // Recharts follows a finger as well as a mouse: tap or drag along the chart to read a day.
            content={(props) => {
              const point = props.payload?.[0]?.payload as BalanceChartPoint | undefined;
              if (!point) return null;
              return (
                <ChartTooltip
                  active={props.active}
                  payload={[{ value: point.balanceCents, color: LINE }]}
                  formatValue={(value) => formatCents(value, locale)}
                  formatLabel={() => point.label}
                />
              );
            }}
          />
          {/* Amber, not red: the threshold is a limit, not an amount. Its label is in the card's legend. */}
          <ReferenceLine y={thresholdCents} stroke={CHART_COLORS.threshold} strokeDasharray="4 4" ifOverflow="extendDomain" />
          <Area
            type="stepAfter"
            dataKey="actualCents"
            stroke={LINE}
            strokeWidth={2.5}
            fill={LINE}
            fillOpacity={0.15}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Area
            type="stepAfter"
            dataKey="projectedCents"
            stroke={LINE}
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeOpacity={0.8}
            fill={LINE}
            fillOpacity={0.06}
            isAnimationActive={false}
            connectNulls={false}
          />
          {lowest && (
            <ReferenceDot x={lowest.day} y={lowest.balanceCents} r={5} fill="var(--card)" stroke={LINE} strokeWidth={2.5} ifOverflow="extendDomain" />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
