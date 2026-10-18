import type { ReactNode } from "react";

interface TooltipEntry {
  name?: string | number;
  value?: unknown;
  color?: string;
  payload?: unknown;
}

/** The subset of Recharts' tooltip content props this component reads. */
export interface ChartTooltipProps {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: unknown;
  /** Replaces the default label (the axis value), e.g. with a long month name. */
  formatLabel?: (label: unknown, payload: readonly TooltipEntry[]) => ReactNode;
  formatValue: (value: number) => string;
}

/**
 * The one tooltip look: popover card, bold label, a coloured dot per series and amounts with
 * cents. Pass it to Recharts as `content={(props) => <ChartTooltip {...props} formatValue={…} />}`.
 * Purely visual; the chart wrapper is aria-hidden and a table carries the data.
 */
export function ChartTooltip({ active, payload, label, formatLabel, formatValue }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const heading = formatLabel ? formatLabel(label, payload) : label;
  return (
    <div className="bg-popover text-popover-foreground rounded-lg border px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-semibold">{heading as ReactNode}</p>
      <ul className="flex flex-col gap-0.5">
        {payload.map((entry, i) => (
          <li key={`${entry.name}-${i}`} className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: entry.color }} />
            {entry.name !== undefined && entry.name !== "" && <span className="text-muted-foreground">{entry.name}</span>}
            <span className="ml-auto pl-3 font-medium tabular-nums">{formatValue(Number(entry.value))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
