import { describe, expect, it } from "vitest";

import {
  decodeCursor,
  encodeCursor,
  filtersToSearchParams,
  formatDayInput,
  monthRange,
  parseDayInput,
  parseEuroInput,
  parseTransactionFilters,
  periodPreset,
  withParams,
} from "./filters";

const UUID = "3f2b8c1e-5d4a-4b6f-8a7c-1234567890ab";

describe("parseEuroInput", () => {
  it.each([
    ["12", 1200],
    ["12,5", 1250],
    ["12.50", 1250],
    ["0,05", 5],
    [" 7 ", 700],
    ["0", 0],
  ])("parses %j", (input, expected) => {
    expect(parseEuroInput(input)).toBe(expected);
  });

  it.each(["", "-5", "+5", "abc", "1,234", "1,2,3", "1e3", "12 €", "99999999999"])("rejects %j", (input) => {
    expect(parseEuroInput(input)).toBeNull();
  });
});

describe("parseTransactionFilters", () => {
  it("defaults to direction all with nothing else", () => {
    expect(parseTransactionFilters({})).toEqual({ direction: "all" });
  });

  it("parses every valid param", () => {
    expect(
      parseTransactionFilters({
        q: "  orange ",
        from: "2025-01-01",
        to: "2025-02-28",
        category: UUID,
        min: "12,50",
        max: "100",
        direction: "out",
      }),
    ).toEqual({
      q: "orange",
      from: "2025-01-01",
      to: "2025-02-28",
      category: UUID,
      min: 1250,
      max: 10000,
      direction: "out",
    });
  });

  it("accepts category=none and leap days", () => {
    expect(parseTransactionFilters({ category: "none", from: "2024-02-29" })).toEqual({
      category: "none",
      from: "2024-02-29",
      direction: "all",
    });
  });

  it("drops invalid params instead of throwing", () => {
    expect(
      parseTransactionFilters({
        q: "   ",
        from: "2025-02-30",
        to: "2025-13-01",
        category: "not-a-uuid",
        min: "-5",
        max: "abc",
        direction: "sideways",
      }),
    ).toEqual({ direction: "all" });
    expect(parseTransactionFilters({ from: "2023-02-29" })).toEqual({ direction: "all" });
  });

  it("drops over-long search text", () => {
    expect(parseTransactionFilters({ q: "a".repeat(101) })).toEqual({ direction: "all" });
    expect(parseTransactionFilters({ q: "a".repeat(100) }).q).toHaveLength(100);
  });

  it("drops array params", () => {
    expect(parseTransactionFilters({ q: ["a", "b"], direction: ["in"], min: ["1"] })).toEqual({
      direction: "all",
    });
  });

  it("swaps min and max when reversed", () => {
    expect(parseTransactionFilters({ min: "50", max: "10" })).toEqual({
      min: 1000,
      max: 5000,
      direction: "all",
    });
  });

  it("accepts a record built from URLSearchParams", () => {
    const sp = Object.fromEntries(new URLSearchParams("q=caf%C3%A9&direction=in&min=1.5"));
    expect(parseTransactionFilters(sp)).toEqual({ q: "café", direction: "in", min: 150 });
  });
});

describe("filtersToSearchParams", () => {
  it("omits defaults", () => {
    expect(filtersToSearchParams({ direction: "all" }).toString()).toBe("");
  });

  it("formats cents back to euro text", () => {
    const params = filtersToSearchParams({ min: 1250, max: 1200, direction: "in" });
    expect(params.get("min")).toBe("12,50");
    expect(params.get("max")).toBe("12");
    expect(params.get("direction")).toBe("in");
    expect(filtersToSearchParams({ min: 5, direction: "all" }).get("min")).toBe("0,05");
    expect(filtersToSearchParams({ min: 0, direction: "all" }).get("min")).toBe("0");
  });

  it("round-trips through parseTransactionFilters", () => {
    const filters = {
      q: "a & b %",
      from: "2025-01-01",
      to: "2025-03-31",
      category: UUID,
      min: 1250,
      max: 99905,
      direction: "out" as const,
    };
    const params = filtersToSearchParams(filters);
    expect(parseTransactionFilters(Object.fromEntries(params))).toEqual(filters);
    expect(filtersToSearchParams(parseTransactionFilters(Object.fromEntries(params))).toString()).toBe(
      params.toString(),
    );
  });
});

describe("cursor", () => {
  it("round-trips", () => {
    const cursor = { date: "2025-02-14", id: UUID };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each([
    "",
    "garbage",
    `2025-02-30_${UUID}`,
    `2025-02-14_${UUID}x`,
    `2025-02-14-${UUID}`,
    "2025-02-14_not-a-uuid-not-a-uuid-not-a-uuid-1234",
    `2025-02-14_${UUID}'; DROP TABLE transactions;--`,
    `${UUID}_2025-02-14`,
  ])("rejects tampered cursor %j", (raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});

describe("account filter", () => {
  it("parses a uuid and drops junk", () => {
    expect(parseTransactionFilters({ account: UUID }).account).toBe(UUID);
    expect(parseTransactionFilters({ account: "nope" }).account).toBeUndefined();
    expect(parseTransactionFilters({ account: ["a", "b"] }).account).toBeUndefined();
    expect(parseTransactionFilters({}).account).toBeUndefined();
  });

  it("round-trips through filtersToSearchParams", () => {
    const params = filtersToSearchParams({ direction: "all", account: UUID });
    expect(params.toString()).toBe(`account=${UUID}`);
    expect(parseTransactionFilters(Object.fromEntries(params)).account).toBe(UUID);
  });
});

describe("tag filter", () => {
  it("parses a uuid and drops junk", () => {
    expect(parseTransactionFilters({ tag: UUID }).tag).toBe(UUID);
    expect(parseTransactionFilters({ tag: "nope" }).tag).toBeUndefined();
    expect(parseTransactionFilters({ tag: ["a", "b"] }).tag).toBeUndefined();
    expect(parseTransactionFilters({}).tag).toBeUndefined();
  });

  it("round-trips through filtersToSearchParams", () => {
    const params = filtersToSearchParams({ direction: "all", tag: UUID });
    expect(params.toString()).toBe(`tag=${UUID}`);
    expect(parseTransactionFilters(Object.fromEntries(params)).tag).toBe(UUID);
  });
});

describe("transfers filter", () => {
  it("parses hide and only, drops anything else", () => {
    expect(parseTransactionFilters({ transfers: "hide" }).transfers).toBe("hide");
    expect(parseTransactionFilters({ transfers: "only" }).transfers).toBe("only");
    expect(parseTransactionFilters({ transfers: "all" }).transfers).toBeUndefined();
    expect(parseTransactionFilters({ transfers: ["hide", "only"] }).transfers).toBeUndefined();
  });

  it("serializes back to the URL and omits it when unset", () => {
    expect(filtersToSearchParams({ direction: "all", transfers: "only" }).get("transfers")).toBe("only");
    expect(filtersToSearchParams({ direction: "all" }).has("transfers")).toBe(false);
  });
});

describe("ignored filter", () => {
  it("parses show and only, drops anything else (unset hides ignored rows)", () => {
    expect(parseTransactionFilters({ ignored: "show" }).ignored).toBe("show");
    expect(parseTransactionFilters({ ignored: "only" }).ignored).toBe("only");
    expect(parseTransactionFilters({ ignored: "hide" }).ignored).toBeUndefined();
    expect(parseTransactionFilters({ ignored: ["show", "only"] }).ignored).toBeUndefined();
    expect(parseTransactionFilters({}).ignored).toBeUndefined();
  });

  it("serializes back to the URL and omits it when unset", () => {
    expect(filtersToSearchParams({ direction: "all", ignored: "show" }).get("ignored")).toBe("show");
    expect(filtersToSearchParams({ direction: "all" }).has("ignored")).toBe(false);
  });
});

describe("parseDayInput", () => {
  it("accepts day-first text with several separators and ISO", () => {
    expect(parseDayInput("28/09/2026")).toBe("2026-09-28");
    expect(parseDayInput("3/9/2026")).toBe("2026-09-03");
    expect(parseDayInput("03.09.2026")).toBe("2026-09-03");
    expect(parseDayInput(" 03-09-2026 ")).toBe("2026-09-03");
    expect(parseDayInput("2026-09-28")).toBe("2026-09-28");
  });

  it("rejects impossible dates and junk", () => {
    expect(parseDayInput("31/02/2026")).toBeNull();
    expect(parseDayInput("29/02/2025")).toBeNull();
    expect(parseDayInput("29/02/2024")).toBe("2024-02-29");
    expect(parseDayInput("10/13/2026")).toBeNull();
    expect(parseDayInput("0/1/2026")).toBeNull();
    expect(parseDayInput("2026-02-30")).toBeNull();
    expect(parseDayInput("28/09/26")).toBeNull();
    expect(parseDayInput("")).toBeNull();
  });

  it("is accepted by parseTransactionFilters as from/to", () => {
    const f = parseTransactionFilters({ from: "01/09/2026", to: "30/09/2026" });
    expect(f.from).toBe("2026-09-01");
    expect(f.to).toBe("2026-09-30");
    expect(parseTransactionFilters({ from: "31/02/2026" }).from).toBeUndefined();
  });
});

describe("withParams", () => {
  const base = new URLSearchParams("q=cafe&direction=out");

  it("sets, replaces and deletes params without touching the input", () => {
    expect(withParams(base, { from: "2026-09-01" })).toBe("?q=cafe&direction=out&from=2026-09-01");
    expect(withParams(base, { direction: "in" })).toBe("?q=cafe&direction=in");
    expect(withParams(base, { direction: null })).toBe("?q=cafe");
    expect(base.toString()).toBe("q=cafe&direction=out");
  });

  it("returns an empty string when nothing is left", () => {
    expect(withParams(new URLSearchParams("q=a"), { q: null })).toBe("");
  });
});

describe("period helpers", () => {
  it("monthRange covers the month, leap February included", () => {
    expect(monthRange("2026-09-15")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthRange("2024-02-10")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("periodPreset handles month, year boundaries", () => {
    expect(periodPreset("thisMonth", "2026-09-15")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodPreset("lastMonth", "2026-09-15")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(periodPreset("lastMonth", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodPreset("last3Months", "2026-09-15")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(periodPreset("last3Months", "2026-02-15")).toEqual({ from: "2025-12-01", to: "2026-02-28" });
    expect(periodPreset("thisYear", "2026-09-15")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("formatDayInput", () => {
  it("writes an ISO day day-first and round-trips through parseDayInput", () => {
    expect(formatDayInput("2026-09-28")).toBe("28/09/2026");
    expect(parseDayInput(formatDayInput("2026-01-05"))).toBe("2026-01-05");
    expect(formatDayInput("")).toBe("");
  });
});

describe("review filter", () => {
  it("parses todo, drops anything else, and round-trips", () => {
    expect(parseTransactionFilters({ review: "todo" }).review).toBe("todo");
    expect(parseTransactionFilters({ review: "done" }).review).toBeUndefined();
    expect(filtersToSearchParams({ direction: "all", review: "todo" }).get("review")).toBe("todo");
    expect(filtersToSearchParams({ direction: "all" }).has("review")).toBe(false);
  });
});
