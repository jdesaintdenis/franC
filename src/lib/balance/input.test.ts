import { describe, expect, it } from "vitest";

import { formatBalanceInput, isValidIsoDate, MAX_BALANCE_CENTS, parseBalanceAmount, parseThresholdAmount } from "./input";

describe("parseBalanceAmount", () => {
  it.each([
    ["-120,50", -12050],
    ["1 234,56", 123456],
    ["1 234,56", 123456],
    ["1234.56", 123456],
    ["+5", 500],
    ["0", 0],
    ["-0", 0],
    ["-0,00", 0],
    ["  75  ", 7500],
    ["10000000", MAX_BALANCE_CENTS],
    ["-10000000", -MAX_BALANCE_CENTS],
  ])("accepts %j", (input, cents) => {
    expect(parseBalanceAmount(input)).toEqual({ ok: true, cents });
  });

  it.each(["", "   "])("treats empty input %j as null", (input) => {
    expect(parseBalanceAmount(input)).toEqual({ ok: true, cents: null });
  });

  it.each(["abc", "1,2,3", "1.234,56", "12,345", "--5", "5€", "1e3", ","])("rejects %j as invalid", (input) => {
    expect(parseBalanceAmount(input)).toEqual({ ok: false, error: "invalid" });
  });

  it.each(["10000000,01", "-10000000,01", "99999999999999999999"])("rejects %j as too large", (input) => {
    expect(parseBalanceAmount(input)).toEqual({ ok: false, error: "too_large" });
  });
});

describe("parseThresholdAmount", () => {
  it("defaults empty input to 0", () => {
    expect(parseThresholdAmount("")).toEqual({ ok: true, cents: 0 });
  });

  it("accepts negative and positive thresholds", () => {
    expect(parseThresholdAmount("-500")).toEqual({ ok: true, cents: -50000 });
    expect(parseThresholdAmount("100,5")).toEqual({ ok: true, cents: 10050 });
  });

  it("forwards errors", () => {
    expect(parseThresholdAmount("x")).toEqual({ ok: false, error: "invalid" });
    expect(parseThresholdAmount("20000000")).toEqual({ ok: false, error: "too_large" });
  });
});

describe("isValidIsoDate", () => {
  it.each(["2026-09-29", "2024-02-29", "2026-12-31"])("accepts %j", (d) => {
    expect(isValidIsoDate(d)).toBe(true);
  });

  it.each(["2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-9-1", "29/09/2026", "", "2026-09-29T00:00"])(
    "rejects %j",
    (d) => {
      expect(isValidIsoDate(d)).toBe(false);
    },
  );
});

describe("formatBalanceInput", () => {
  it.each([
    [0, "en", "0"],
    [123456, "en", "1234.56"],
    [-12050, "fr", "-120,50"],
    [-5, "fr", "-0,05"],
    [-500, "en", "-5"],
  ] as const)("formats %j (%s)", (cents, locale, text) => {
    expect(formatBalanceInput(cents, locale)).toBe(text);
  });

  it("round-trips through parseBalanceAmount", () => {
    for (const cents of [-1000000000, -5, 0, 7, 12050, 1000000000]) {
      for (const locale of ["en", "fr"] as const) {
        expect(parseBalanceAmount(formatBalanceInput(cents, locale))).toEqual({ ok: true, cents });
      }
    }
  });
});
