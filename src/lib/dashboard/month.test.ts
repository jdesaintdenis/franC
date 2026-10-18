import { describe, expect, it } from "vitest";

import {
  addMonths,
  categoryDrillDownHref,
  monthTransfersHref,
  dashboardHref,
  parseCategoryParam,
  subcategoryBreakdownHref,
  currentDate,
  currentMonth,
  fillTrend,
  formatMonthLabel,
  formatShortMonthLabel,
  monthRange,
  monthsEnding,
  parseMonthParam,
} from "./month";

describe("currentDate", () => {
  it("uses the Paris calendar day, not UTC", () => {
    expect(currentDate(new Date("2025-08-31T21:30:00Z"))).toBe("2025-08-31");
    expect(currentDate(new Date("2025-08-31T22:30:00Z"))).toBe("2025-09-01");
  });

  it("rolls over the year in winter time", () => {
    expect(currentDate(new Date("2025-12-31T23:30:00Z"))).toBe("2026-01-01");
  });

  it("accepts another zone", () => {
    expect(currentDate(new Date("2025-09-01T03:00:00Z"), "America/New_York")).toBe("2025-08-31");
  });
});

describe("currentMonth", () => {
  it("uses the Paris calendar, not UTC", () => {
    // 23:30 UTC on Aug 31 is already Sep 1 in Paris (UTC+2 in summer).
    expect(currentMonth(new Date("2025-08-31T23:30:00Z"))).toBe("2025-09");
    expect(currentMonth(new Date("2025-08-31T21:30:00Z"))).toBe("2025-08");
  });

  it("handles the winter offset and year boundary", () => {
    expect(currentMonth(new Date("2025-12-31T23:30:00Z"))).toBe("2026-01");
  });

  it("accepts another zone", () => {
    expect(currentMonth(new Date("2025-09-01T03:00:00Z"), "America/New_York")).toBe("2025-08");
  });
});

describe("parseMonthParam", () => {
  it("accepts valid months", () => {
    expect(parseMonthParam("2025-09", "2025-01")).toBe("2025-09");
  });

  it.each(["2025-13", "2025-00", "2025-9", "25-09", "2025-09-01", "", "abc"])(
    "falls back for %j",
    (value) => {
      expect(parseMonthParam(value, "2025-01")).toBe("2025-01");
    },
  );

  it("falls back for undefined and arrays", () => {
    expect(parseMonthParam(undefined, "2025-01")).toBe("2025-01");
    expect(parseMonthParam(["2025-09", "2025-10"], "2025-01")).toBe("2025-01");
  });
});

describe("addMonths", () => {
  it("adds and subtracts within a year", () => {
    expect(addMonths("2025-09", 1)).toBe("2025-10");
    expect(addMonths("2025-09", -1)).toBe("2025-08");
    expect(addMonths("2025-09", 0)).toBe("2025-09");
  });

  it("rolls over years in both directions", () => {
    expect(addMonths("2025-12", 1)).toBe("2026-01");
    expect(addMonths("2025-01", -1)).toBe("2024-12");
    expect(addMonths("2025-03", -15)).toBe("2023-12");
    expect(addMonths("2025-11", 26)).toBe("2028-01");
  });
});

describe("monthRange", () => {
  it("returns first and last day", () => {
    expect(monthRange("2025-09")).toEqual({ from: "2025-09-01", to: "2025-09-30" });
    expect(monthRange("2025-12")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("is leap-year aware", () => {
    expect(monthRange("2024-02").to).toBe("2024-02-29");
    expect(monthRange("2025-02").to).toBe("2025-02-28");
    expect(monthRange("1900-02").to).toBe("1900-02-28");
    expect(monthRange("2000-02").to).toBe("2000-02-29");
  });
});

describe("monthsEnding", () => {
  it("lists months oldest first across a year boundary", () => {
    expect(monthsEnding("2025-02", 6)).toEqual([
      "2024-09",
      "2024-10",
      "2024-11",
      "2024-12",
      "2025-01",
      "2025-02",
    ]);
  });

  it("returns just the month for count 1", () => {
    expect(monthsEnding("2025-09", 1)).toEqual(["2025-09"]);
  });
});

describe("month labels", () => {
  it("formats the long label in both languages", () => {
    expect(formatMonthLabel("2025-09", "en")).toBe("September 2025");
    expect(formatMonthLabel("2026-01", "en")).toBe("January 2026");
    expect(formatMonthLabel("2025-09", "fr")).toBe("Septembre 2025");
    expect(formatMonthLabel("2026-01", "fr")).toBe("Janvier 2026");
  });

  it("formats the short label in both languages", () => {
    expect(formatShortMonthLabel("2025-01", "en")).toBe("Jan");
    expect(formatShortMonthLabel("2025-05", "en")).toBe("May");
    expect(formatShortMonthLabel("2025-01", "fr")).toBe("janv.");
    expect(formatShortMonthLabel("2025-05", "fr")).toBe("mai");
  });
});

describe("fillTrend", () => {
  it("zero-fills gaps and orders by the requested months", () => {
    const rows = [
      { month: "2025-09", spentCents: 500, incomeCents: 0 },
      { month: "2025-07", spentCents: 100, incomeCents: 2000 },
    ];
    expect(fillTrend(rows, ["2025-07", "2025-08", "2025-09"])).toEqual([
      { month: "2025-07", spentCents: 100, incomeCents: 2000 },
      { month: "2025-08", spentCents: 0, incomeCents: 0 },
      { month: "2025-09", spentCents: 500, incomeCents: 0 },
    ]);
  });

  it("ignores rows outside the requested months", () => {
    expect(fillTrend([{ month: "2020-01", spentCents: 1, incomeCents: 1 }], ["2025-09"])).toEqual([
      { month: "2025-09", spentCents: 0, incomeCents: 0 },
    ]);
  });
});

describe("categoryDrillDownHref", () => {
  it("filters to the month's outflows for a category", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(categoryDrillDownHref("2025-09", id)).toBe(
      `/transactions?from=2025-09-01&to=2025-09-30&category=${id}&direction=out&transfers=hide`,
    );
  });

  it("uses category=none for uncategorized", () => {
    expect(categoryDrillDownHref("2024-02", null)).toBe(
      "/transactions?from=2024-02-01&to=2024-02-29&category=none&direction=out&transfers=hide",
    );
  });
});

describe("monthTransfersHref", () => {
  it("lists the month's internal transfers, optionally for one account", () => {
    const acc = "22222222-2222-4222-8222-222222222222";
    expect(monthTransfersHref("2025-09")).toBe("/transactions?from=2025-09-01&to=2025-09-30&transfers=only");
    expect(monthTransfersHref("2025-09", acc)).toBe(
      `/transactions?from=2025-09-01&to=2025-09-30&account=${acc}&transfers=only`,
    );
  });
});

describe("account-aware links", () => {
  const cat = "123e4567-e89b-12d3-a456-426614174000";
  const acc = "22222222-2222-4222-8222-222222222222";
  it("adds the account to the drill-down link", () => {
    expect(categoryDrillDownHref("2025-09", cat, acc)).toBe(
      `/transactions?from=2025-09-01&to=2025-09-30&category=${cat}&account=${acc}&direction=out&transfers=hide`,
    );
  });
  it("adds the account to the breakdown link", () => {
    expect(subcategoryBreakdownHref("2025-09", cat, acc)).toBe(`/budget?month=2025-09&category=${cat}&account=${acc}`);
  });
  it("builds dashboard links, omitting empty parts", () => {
    expect(dashboardHref({})).toBe("/budget");
    expect(dashboardHref({ account: acc })).toBe(`/budget?account=${acc}`);
    expect(dashboardHref({ month: "2025-09", account: null })).toBe("/budget?month=2025-09");
    expect(dashboardHref({ month: "2025-09", account: acc })).toBe(`/budget?month=2025-09&account=${acc}`);
  });
});

describe("subcategory breakdown helpers", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("builds the breakdown link", () => {
    expect(subcategoryBreakdownHref("2025-09", id)).toBe(`/budget?month=2025-09&category=${id}`);
  });
  it("accepts uuids only", () => {
    expect(parseCategoryParam(id)).toBe(id);
    expect(parseCategoryParam("none")).toBeNull();
    expect(parseCategoryParam(undefined)).toBeNull();
    expect(parseCategoryParam([id, id])).toBeNull();
  });
});

describe("inSentence", () => {
  it("lower-cases French months only", async () => {
    const { inSentence } = await import("./month");
    expect(inSentence("Juillet 2026", "fr")).toBe("juillet 2026");
    expect(inSentence("July 2026", "en")).toBe("July 2026");
  });
});
