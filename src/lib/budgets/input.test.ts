import { describe, expect, it } from "vitest";

import { formatBudgetInput } from "./input";
import { parseBudgetAmount } from "./amount";

describe("formatBudgetInput", () => {
  it("formats whole and fractional euros per locale", () => {
    expect(formatBudgetInput(40000, "en")).toBe("400");
    expect(formatBudgetInput(40050, "en")).toBe("400.50");
    expect(formatBudgetInput(40050, "fr")).toBe("400,50");
    expect(formatBudgetInput(5, "fr")).toBe("0,05");
  });

  it("round-trips through the parser", () => {
    for (const cents of [1, 5, 99, 100, 40050, 123456789, 1_000_000_000]) {
      for (const locale of ["en", "fr"] as const) {
        expect(parseBudgetAmount(formatBudgetInput(cents, locale))).toEqual({ ok: true, cents });
      }
    }
  });
});
