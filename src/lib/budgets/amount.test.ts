import { describe, expect, it } from "vitest";

import { MAX_BUDGET_CENTS, parseBudgetAmount } from "./amount";

describe("parseBudgetAmount", () => {
  it.each([
    ["400", 40000],
    ["400,5", 40050],
    ["400.50", 40050],
    ["400,50", 40050],
    ["1 200,00", 120000],
    ["1 200,00", 120000],
    ["1 200,00", 120000],
    ["  75  ", 7500],
    ["+12", 1200],
    ["0,01", 1],
    ["10000000", MAX_BUDGET_CENTS],
  ])("accepts %j", (input, cents) => {
    expect(parseBudgetAmount(input)).toEqual({ ok: true, cents });
  });

  it.each(["", "   "])("treats empty input %j as remove", (input) => {
    expect(parseBudgetAmount(input)).toEqual({ ok: true, cents: null });
  });

  it.each(["0", "0,00", "-5", "-0", "-12,50"])("rejects non-positive %j", (input) => {
    expect(parseBudgetAmount(input)).toEqual({ ok: false, error: "not_positive" });
  });

  it.each(["10000000,01", "10000001", "99999999999999999999"])("rejects too large %j", (input) => {
    expect(parseBudgetAmount(input)).toEqual({ ok: false, error: "too_large" });
  });

  it.each(["abc", "12,345", "12.345", "1,2,3", "1.200,50", "12€", "400,", ",5", "1e3", "--5"])(
    "rejects invalid %j",
    (input) => {
      expect(parseBudgetAmount(input)).toEqual({ ok: false, error: "invalid" });
    },
  );
});
