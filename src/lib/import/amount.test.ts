// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseAmountToCents } from "./amount";

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
