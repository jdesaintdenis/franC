// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseAmountToCents, parseCsvAmount } from "./amount";

describe("parseAmountToCents", () => {
  it.each([
    ["-66,50", -6650],
    ["+2896,40", 289640],
    ["-57,00", -5700],
    ["5", 500],
    ["5,5", 550],
  ])("parses %s", (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  it.each(["12.3", "1,234", "abc", ""])("rejects %j", (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });
});

describe("parseCsvAmount", () => {
  it.each([
    ["-1 234,56", ",", -123456],
    ["1.234,56 €", ",", 123456],
    ["-1,234.56", ".", -123456],
    ["+12.5", ".", 1250],
    ["12 EUR", ",", 1200],
    ["1\u00a0234,00", ",", 123400],
    ["-0,00", ",", 0],
  ] as const)("parses %j with %j", (input, decimal, expected) => {
    expect(parseCsvAmount(input, decimal)).toBe(expected);
  });

  it.each([["1,234", ","], ["12.345", "."], ["abc", ","], ["", "."]] as const)("rejects %j with %j", (input, decimal) => {
    expect(parseCsvAmount(input, decimal)).toBeNull();
  });
});
