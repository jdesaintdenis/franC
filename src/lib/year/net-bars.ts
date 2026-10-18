export interface NetBarScale {
  posMax: number;
  negMax: number;
  /** Share of the bar area (0-100) above the zero axis. */
  axisPct: number;
}

/** The scale of the year's net bars: positives rise above an axis, negatives hang below it. */
export function netBarScale(nets: readonly number[]): NetBarScale {
  const posMax = Math.max(0, ...nets);
  const negMax = Math.max(0, ...nets.map((n) => -n));
  const axisPct = negMax === 0 ? 100 : posMax === 0 ? 0 : Math.round((posMax / (posMax + negMax)) * 100);
  return { posMax, negMax, axisPct };
}
