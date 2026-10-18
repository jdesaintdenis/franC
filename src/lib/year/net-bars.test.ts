import { describe, expect, it } from "vitest";

import { netBarScale } from "./net-bars";

describe("netBarScale", () => {
  it("puts the axis at the bottom when nothing is negative", () => {
    expect(netBarScale([100, 300])).toEqual({ posMax: 300, negMax: 0, axisPct: 100 });
  });
  it("puts the axis at the top when nothing is positive", () => {
    expect(netBarScale([-100, -300])).toEqual({ posMax: 0, negMax: 300, axisPct: 0 });
  });
  it("splits the height by the two extremes", () => {
    expect(netBarScale([300, -100])).toEqual({ posMax: 300, negMax: 100, axisPct: 75 });
  });
  it("copes with all zeros and no values", () => {
    expect(netBarScale([0, 0]).axisPct).toBe(100);
    expect(netBarScale([]).axisPct).toBe(100);
  });
});
