import type { ReactNode } from "react";

import { BlockGauge } from "./block-gauge";

/**
 * A goal in the budgets' row shape: emoji tile, name, one detail line, a trailing figure or button,
 * and the sand gauge. Shared by Home and Settings > Goals; the caller owns the grid (`GAUGE_ROW_CLASS`).
 */
export function GoalGaugeRowContent({
  icon,
  name,
  detail,
  percent,
  trailing,
}: {
  icon: string | null;
  name: string;
  detail: ReactNode;
  percent: number;
  trailing?: ReactNode;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="bg-secondary row-span-2 flex size-8 items-center justify-center rounded-[10px] text-lg"
      >
        {icon ?? "🎯"}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">{name}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {detail}
        </span>
      </span>
      {trailing ?? <span aria-hidden="true" className="row-span-2" />}
      <BlockGauge percent={percent} tone="sand" />
    </>
  );
}
