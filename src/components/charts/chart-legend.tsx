export interface LegendItem {
  label: string;
  color: string;
}

/**
 * Dots with text in the normal foreground colour (series-coloured text reads badly in one theme
 * or the other). Sits above the chart so it is seen before the bars. The data is also in the
 * chart's table, so the legend is hidden from assistive tech.
 */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul aria-hidden="true" className="text-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
