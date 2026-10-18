import { describe, expect, it } from "vitest";

import { centsToDecimal } from "./amount";

describe("centsToDecimal", () => {
  it.each([
    [0, ".", "0.00"],
    [5, ".", "0.05"],
    [-5, ".", "-0.05"],
    [-6650, ".", "-66.50"],
    [-6650, ",", "-66,50"],
    [289640, ",", "2896,40"],
    [289640, ".", "2896.40"],
    [-2147483648, ".", "-21474836.48"],
    [-2147483648, ",", "-21474836,48"],
  ] as const)("%i with %s -> %s", (cents, sep, expected) => {
    expect(centsToDecimal(cents, sep)).toBe(expected);
  });
});
