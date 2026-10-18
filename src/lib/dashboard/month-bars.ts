import { addMonths } from "./month";

export interface MonthBar {
  month: string;
  spentCents: number;
  /** "next" is the month after the current one: its height is what is planned, not spent. */
  kind: "past" | "current" | "next";
  selected: boolean;
}

const WINDOW = 9;

/**
 * Nine months ending four after the selected one (never past the current month), so a month
 * picked far back still has its neighbours to tap. The next month is appended, as an outline,
 * only when the window reaches the current month.
 */
export function monthBarWindow(args: {
  selected: string;
  current: string;
  spentByMonth: ReadonlyMap<string, number>;
  nextPlannedCents: number;
}): MonthBar[] {
  const { selected, current, spentByMonth, nextPlannedCents } = args;
  const ahead = addMonths(selected, 4);
  const end = ahead < current ? ahead : current;
  const bars: MonthBar[] = Array.from({ length: WINDOW }, (_, i) => {
    const month = addMonths(end, i - (WINDOW - 1));
    return {
      month,
      spentCents: spentByMonth.get(month) ?? 0,
      kind: month === current ? "current" : "past",
      selected: month === selected,
    };
  });
  if (end === current) {
    bars.push({ month: addMonths(current, 1), spentCents: nextPlannedCents, kind: "next", selected: false });
  }
  return bars;
}

/** Top of the chart: room above the tallest bar and the planned line. */
export function monthBarScale(bars: readonly MonthBar[], plannedCents: number): number {
  const max = Math.max(plannedCents, ...bars.map((b) => b.spentCents));
  return Math.max(1, Math.round(max * 1.1));
}
