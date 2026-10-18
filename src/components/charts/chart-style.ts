import type { CSSProperties } from "react";

/**
 * One look for every chart. Colours are tokens from globals.css (they flip with the theme via
 * light-dark()), never literals, and there is no red: red is not used for amounts or charts.
 */
export const CHART_COLORS = {
  spent: "var(--chart-1)",
  income: "var(--chart-2)",
  balance: "var(--brand)",
  threshold: "var(--warning)",
} as const;

const TABULAR: CSSProperties = { fontVariantNumeric: "tabular-nums" };

/** Axis labels: muted, tabular figures so amounts line up. `small` for the 12-month axis. */
export function axisTick(small = false) {
  return { fill: "var(--muted-foreground)", fontSize: small ? 11 : 12, style: TABULAR };
}

/** Horizontal grid lines only: they carry the amounts, vertical lines would only add noise. */
export const GRID = { vertical: false, stroke: "var(--border)" } as const;

/** Width that fits "€1.5k" / "1,5 k€" at the axis font size. */
export const Y_AXIS_WIDTH = 44;

/** Bars that are not selected while another one is. */
export const DIMMED_OPACITY = 0.35;
/** Bars outside the viewed month on Home when nothing is selected. */
export const MUTED_OPACITY = 0.45;

/** Centre label of a donut: caption above, bold total below. */
export const CENTER_LABEL_CLASSES = {
  caption: "text-muted-foreground text-[13px]",
  value: "text-xl font-extrabold tabular-nums",
} as const;
