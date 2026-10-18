import { addDays, daysBetween } from "../recurring/dates";

export interface MonthCurvePoint {
  /** "YYYY-MM-DD" */
  date: string;
  /** End-of-day balance in cents. */
  balanceCents: number;
  /** True for days after the last known one: recurring payments and the rest of the budgets. */
  projected: boolean;
}

/**
 * End-of-day balances over one month, so months can be compared. Days up to `asOf` are rebuilt
 * backwards from the known balance and the day-by-day net; days after it follow the projection,
 * minus `spreadCents` (the non-recurring spending still planned) spread evenly over those days.
 */
export function monthBalanceCurve(args: {
  /** Balance at the end of `asOf`. */
  balanceCents: number;
  asOf: string;
  /** Net amount per day, covering (monthStart - 1, asOf]. A missing day is 0. */
  dailyNet: ReadonlyMap<string, number>;
  /** Projected balances after `asOf` (recurring only). */
  projection: readonly { date: string; balanceCents: number }[];
  spreadCents: number;
  monthStart: string;
  monthEnd: string;
}): MonthCurvePoint[] {
  const { balanceCents, asOf, dailyNet, projection, spreadCents, monthStart, monthEnd } = args;
  const points: MonthCurvePoint[] = [];

  // Real run, walked backwards once: balance(d - 1) = balance(d) - net(d).
  let running = balanceCents;
  for (let d = asOf; d >= monthStart; d = addDays(d, -1)) {
    if (d <= monthEnd) points.push({ date: d, balanceCents: running, projected: false });
    running -= dailyNet.get(d) ?? 0;
  }
  points.reverse();

  const first = addDays(asOf, 1);
  if (first > monthEnd) return points;
  const byDate = new Map(projection.map((p) => [p.date, p.balanceCents]));
  const lastProjected = projection.length > 0 ? projection[projection.length - 1].date : asOf;
  const days = daysBetween(asOf, monthEnd);
  const perDay = Math.floor(spreadCents / days);
  let carried = balanceCents;
  for (let i = 1; i <= days; i++) {
    const date = addDays(asOf, i);
    if (date > lastProjected) break;
    carried = byDate.get(date) ?? carried;
    const spread = perDay * i + (i === days ? spreadCents - perDay * days : 0);
    points.push({ date, balanceCents: carried - spread, projected: true });
  }
  return points;
}

/** Adds accounts' curves day by day; an account carries its last value (and starts at its first). */
export function sumCurves(curves: readonly (readonly MonthCurvePoint[])[]): MonthCurvePoint[] {
  const dates = [...new Set(curves.flatMap((c) => c.map((p) => p.date)))].sort();
  const lookups = curves.map((c) => new Map(c.map((p) => [p.date, p])));
  const last = curves.map((c) => c[0]);
  return dates.map((date) => {
    let total = 0;
    let projected = false;
    lookups.forEach((lookup, i) => {
      const point = lookup.get(date);
      if (point) last[i] = point;
      if (last[i]) {
        total += last[i].balanceCents;
        projected ||= last[i].projected && lookup.has(date);
      }
    });
    return { date, balanceCents: total, projected };
  });
}
