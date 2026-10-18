import { describe, expect, it } from "vitest";

import { niceTicks } from "./ticks";

describe("niceTicks", () => {
  it("gives a small default scale when there is no data", () => {
    expect(niceTicks(0)).toEqual([0, 100, 200]);
    expect(niceTicks(-5)).toEqual([0, 100, 200]);
    expect(niceTicks(Number.NaN)).toEqual([0, 100, 200]);
  });

  it("rounds the step up to 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceTicks(258_000)).toEqual([0, 200_000, 400_000]);
    expect(niceTicks(150_000)).toEqual([0, 100_000, 200_000]);
    expect(niceTicks(40_000)).toEqual([0, 20_000, 40_000]);
  });

  it("never cuts the tallest bar off", () => {
    for (const max of [1, 99, 100, 101, 199_999, 200_000, 303_000, 12_345_678]) {
      const [zero, mid, top] = niceTicks(max);
      expect(zero).toBe(0);
      expect(top).toBe(mid * 2);
      expect(top).toBeGreaterThanOrEqual(max);
      expect(Number.isInteger(mid)).toBe(true);
    }
  });

  it("keeps the top tick close to the data", () => {
    // Never more than 2.5x the data once past the minimum scale.
    for (const max of [300, 5_100, 258_000, 303_000]) expect(niceTicks(max)[2]).toBeLessThan(max * 2.5);
  });
});
