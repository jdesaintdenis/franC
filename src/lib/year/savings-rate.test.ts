import { describe, expect, it } from "vitest";

import { savingsRate, savingsRatePercent } from "./savings-rate";

describe("savingsRate", () => {
  it("is the saved fraction of income", () => {
    expect(savingsRate(200000, 150000)).toBe(0.25);
  });
  it("is negative when overspending", () => {
    expect(savingsRate(100000, 150000)).toBe(-0.5);
  });
  it("is null without income", () => {
    expect(savingsRate(0, 100)).toBeNull();
    expect(savingsRate(-5, 100)).toBeNull();
  });
});

describe("savingsRatePercent", () => {
  it("rounds half away from zero", () => {
    expect(savingsRatePercent(200000, 150000)).toBe(25);
    expect(savingsRatePercent(200, 199)).toBe(1); // 0.5% -> 1
    expect(savingsRatePercent(200, 201)).toBe(-1); // -0.5% -> -1
    expect(savingsRatePercent(3, 2)).toBe(33);
    expect(savingsRatePercent(3, 4)).toBe(-33);
  });
  it("handles 0 and null", () => {
    expect(savingsRatePercent(1000, 1000)).toBe(0);
    expect(savingsRatePercent(0, 10)).toBeNull();
  });
});
