import { describe, expect, it } from "vitest";

import { isUnderOnePercent, percentShares } from "./shares";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("percentShares", () => {
  it("gives a single part 100%", () => {
    expect(percentShares([1234])).toEqual([100]);
  });

  it("keeps exact splits exact", () => {
    expect(percentShares([7500, 2500])).toEqual([75, 25]);
  });

  it("adds up to 100 where plain rounding would not", () => {
    // Plain rounding: 33 + 33 + 33 = 99.
    expect(percentShares([100, 100, 100])).toEqual([34, 33, 33]);
    // Plain rounding: 17 + 17 + 17 + 17 + 17 + 17 = 102 (each is 16.67%).
    const sixths = percentShares([1, 1, 1, 1, 1, 1]);
    expect(sum(sixths)).toBe(100);
    expect(sixths).toEqual([17, 17, 17, 17, 16, 16]);
  });

  it("gives the missing points to the largest remainders first", () => {
    // 66.6..., 16.6..., 16.6... -> 66 + 16 + 16 = 98, the two largest remainders get +1.
    expect(percentShares([4000, 1000, 1000])).toEqual([67, 17, 16]);
  });

  it("can round a tiny share down to 0, which the UI shows as <1%", () => {
    const shares = percentShares([99_900, 50, 50]);
    expect(sum(shares)).toBe(100);
    expect(shares[1]).toBe(0);
    expect(isUnderOnePercent(50, shares[1])).toBe(true);
    expect(isUnderOnePercent(0, 0)).toBe(false);
    expect(isUnderOnePercent(99_900, shares[0])).toBe(false);
  });

  it("returns zeros for a zero total and nothing for no parts", () => {
    expect(percentShares([0, 0])).toEqual([0, 0]);
    expect(percentShares([])).toEqual([]);
  });

  it("refuses negative parts instead of producing odd shares", () => {
    expect(percentShares([500, -100])).toEqual([0, 0]);
  });

  it("stays exact on large amounts", () => {
    const shares = percentShares([123_456_789_01, 98_765_432_10, 1]);
    expect(sum(shares)).toBe(100);
    expect(shares).toEqual([56, 44, 0]);
  });
});
