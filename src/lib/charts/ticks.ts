const MANTISSAS = [1, 2, 2.5, 5] as const;

/**
 * Three Y-axis ticks (0, middle, top) for a bar chart whose tallest bar is `maxCents`.
 * The step is a "nice" amount (1, 2, 2.5 or 5 times a power of ten, from 1 euro up), so
 * the labels read €500 / €1k / €2k rather than €873 / €1.7k. The top tick is never
 * below the data, so no bar is cut off. Integer cents throughout.
 */
export function niceTicks(maxCents: number): [number, number, number] {
  const max = Number.isFinite(maxCents) && maxCents > 0 ? maxCents : 0;
  for (let power = 100; ; power *= 10) {
    for (const mantissa of MANTISSAS) {
      const step = Math.round(mantissa * power);
      if (step * 2 >= max) return [0, step, step * 2];
    }
  }
}
