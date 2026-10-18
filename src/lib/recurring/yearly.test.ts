import { describe, expect, it } from "vitest";

import { yearlyCents } from "./yearly";

describe("yearlyCents", () => {
  it("counts 52 weekly charges", () => {
    expect(yearlyCents(-1_000, "weekly")).toBe(-52_000);
  });

  it("counts 12 monthly charges", () => {
    expect(yearlyCents(-1_299, "monthly")).toBe(-15_588);
  });

  it("counts 4 quarterly charges", () => {
    expect(yearlyCents(-4_500, "quarterly")).toBe(-18_000);
  });

  it("counts a yearly charge once", () => {
    expect(yearlyCents(-6_900, "yearly")).toBe(-6_900);
  });

  it("keeps the sign of income", () => {
    expect(yearlyCents(250_000, "monthly")).toBe(3_000_000);
  });
});
