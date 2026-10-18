"use client";

import { useId } from "react";

import type { PaceSeries } from "@/lib/safe-to-spend/pace-series";

const W = 300;
const H = 80;
const BASE = 76;
const TOP = 6;

/**
 * The hero's month chart: cumulative spending so far (solid) against an even pace that lands on
 * zero left at month end (dashed), with a dot for today. The shapes are SVG stretched to the card;
 * the dot and the labels are HTML so they never distort. The same facts are in the text above, so
 * the whole chart is hidden from assistive technology.
 */
export function PaceChart({
  series,
  startLabel,
  endLabel,
  todayLabel,
  plannedLabel,
}: {
  series: PaceSeries;
  startLabel: string;
  endLabel: string;
  todayLabel: string;
  plannedLabel: string;
}) {
  const gradientId = useId();
  const { daysInMonth, today, spent, plannedTotalCents } = series;
  const last = spent[spent.length - 1]?.spentCents ?? 0;
  const max = Math.max(plannedTotalCents, last, 1);
  const x = (day: number) => (day / daysInMonth) * W;
  const y = (cents: number) => BASE - (cents / max) * (BASE - TOP);
  const points = [{ day: 0, spentCents: 0 }, ...spent];
  const line = points.map((p) => `${x(p.day).toFixed(1)},${y(p.spentCents).toFixed(1)}`).join(" ");
  const todayX = x(today);
  const area = `0,${BASE} ${line} ${todayX.toFixed(1)},${BASE}`;
  // Keep the "today" caption inside the card whatever the day.
  const todayLeft = Math.min(84, Math.max(8, (todayX / W) * 100));

  return (
    <div aria-hidden="true" data-testid="pace-chart" className="text-primary relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-20 w-full">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={0} y1={BASE} x2={W} y2={y(plannedTotalCents)} stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <line x1={todayX} y1={TOP} x2={todayX} y2={BASE} stroke="currentColor" strokeOpacity="0.3" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        className="bg-primary absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ left: `${(todayX / W) * 100}%`, top: `${(y(last) / H) * 100}%` }}
      />
      <span className="text-muted-foreground absolute top-0 right-24 text-[10px]">{plannedLabel}</span>
      <div className="text-muted-foreground relative mt-0.5 h-3.5 text-[10px]">
        <span className="absolute left-0">{startLabel}</span>
        <span className="absolute" style={{ left: `${todayLeft}%` }}>{todayLabel}</span>
        <span className="absolute right-0">{endLabel}</span>
      </div>
    </div>
  );
}
