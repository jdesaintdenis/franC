import { describe, expect, it } from "vitest";

import { priceIncrease } from "./price-change";

describe("priceIncrease", () => {
  it("is the extra cost in cents and as a ratio of the old price", () => {
    expect(priceIncrease(-3999, -4499)).toEqual({ diffCents: 500, ratio: 500 / 3999 });
  });

  it("does not divide by zero", () => {
    expect(priceIncrease(0, -100).ratio).toBe(0);
  });
});
