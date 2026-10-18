import { describe, expect, it } from "vitest";

import {
  filterByCategory,
  parseRecurringView,
  recurringHref,
  regularTotals,
  sortItems,
  UNCATEGORIZED,
  usedCategoryIds,
  yearlyTotals,
  type ViewItem,
} from "./list-view";

const categories = [
  { id: "home", parentId: null },
  { id: "internet", parentId: "home" },
  { id: "fun", parentId: null },
];

const netflix: ViewItem = { id: "1", name: "Netflix", status: "confirmed", typicalAmountCents: -1_399, interval: "monthly", categoryId: "fun" };
const box: ViewItem = { id: "2", name: "Box", status: "confirmed", typicalAmountCents: -2_999, interval: "monthly", categoryId: "internet" };
const insurance: ViewItem = { id: "3", name: "Insurance", status: "detected", typicalAmountCents: -24_000, interval: "yearly", categoryId: "home" };
const gym: ViewItem = { id: "4", name: "Gym", status: "detected", typicalAmountCents: -1_000, interval: "weekly", categoryId: null };
const salary: ViewItem = { id: "5", name: "Salary", status: "confirmed", typicalAmountCents: 250_000, interval: "monthly", categoryId: null };
const old: ViewItem = { id: "6", name: "Old", status: "ended", typicalAmountCents: -999, interval: "monthly", categoryId: "fun" };
const items = [netflix, box, insurance, gym, salary, old];

describe("parseRecurringView", () => {
  it("defaults to all categories, sorted by next date", () => {
    expect(parseRecurringView({}, ["home"])).toEqual({ category: null, sort: "next" });
  });

  it("accepts own categories, uncategorized and the yearly sort", () => {
    expect(parseRecurringView({ category: "home", sort: "yearly" }, ["home"])).toEqual({ category: "home", sort: "yearly" });
    expect(parseRecurringView({ category: UNCATEGORIZED }, [])).toEqual({ category: UNCATEGORIZED, sort: "next" });
  });

  it("ignores foreign categories and unknown sorts", () => {
    expect(parseRecurringView({ category: "someone-else", sort: "price" }, ["home"])).toEqual({ category: null, sort: "next" });
    expect(parseRecurringView({ category: ["home"] }, ["home"])).toEqual({ category: null, sort: "next" });
  });
});

describe("filterByCategory", () => {
  it("keeps everything without a category filter", () => {
    expect(filterByCategory(items, null, categories)).toHaveLength(items.length);
  });

  it("includes subcategories under a top-level category", () => {
    expect(filterByCategory(items, "home", categories).map((i) => i.name)).toEqual(["Box", "Insurance"]);
  });

  it("matches a subcategory on its own", () => {
    expect(filterByCategory(items, "internet", categories).map((i) => i.name)).toEqual(["Box"]);
  });

  it("keeps uncategorized items", () => {
    expect(filterByCategory(items, UNCATEGORIZED, categories).map((i) => i.name)).toEqual(["Gym", "Salary"]);
  });
});

describe("sortItems", () => {
  it("keeps the server order for 'next'", () => {
    expect(sortItems(items, "next")).toEqual(items);
  });

  it("puts the largest yearly outflow first and income last", () => {
    // Gym 520 €, Box 359,88 €, Insurance 240 €, Netflix 167,88 €, Old 119,88 €, then salary.
    expect(sortItems(items, "yearly").map((i) => i.name)).toEqual(["Gym", "Box", "Insurance", "Netflix", "Old", "Salary"]);
  });
});

describe("yearlyTotals", () => {
  it("sums confirmed outflows and keeps detected ones apart; skips income and ended items", () => {
    expect(yearlyTotals(items)).toEqual({
      confirmedOutCents: 1_399 * 12 + 2_999 * 12,
      detectedOutCents: 24_000 + 1_000 * 52,
      detectedOutCount: 2,
    });
  });
});

describe("usedCategoryIds", () => {
  it("offers used categories and their parents, and flags uncategorized", () => {
    const { ids, hasUncategorized } = usedCategoryIds([box, gym], categories);
    expect([...ids].sort()).toEqual(["home", "internet"]);
    expect(hasUncategorized).toBe(true);
  });
});

describe("regularTotals", () => {
  it("sums confirmed items per month from yearly totals, floored once, and counts detected ones apart", () => {
    expect(regularTotals(items)).toEqual({
      confirmedMonthlyOutCents: 4_398, // 52 776 / 12
      confirmedYearlyOutCents: 52_776,
      confirmedOutCount: 2,
      confirmedMonthlyInCents: 250_000,
      toConfirmCount: 2,
      detectedMonthlyOutCents: 6_333, // (24 000 + 52 000) / 12
    });
  });

  it("leaves out ended and dismissed items and counts detected income as to confirm", () => {
    const dismissed: ViewItem = { ...netflix, id: "7", status: "dismissed" };
    const detectedIncome: ViewItem = { ...salary, id: "8", status: "detected", typicalAmountCents: 10_000, interval: "quarterly" };
    expect(regularTotals([old, dismissed])).toEqual({
      confirmedMonthlyOutCents: 0,
      confirmedYearlyOutCents: 0,
      confirmedOutCount: 0,
      confirmedMonthlyInCents: 0,
      toConfirmCount: 0,
      detectedMonthlyOutCents: 0,
    });
    expect(regularTotals([detectedIncome])).toMatchObject({ toConfirmCount: 1, confirmedMonthlyInCents: 0, detectedMonthlyOutCents: 0 });
  });
});

describe("recurringHref", () => {
  it("keeps account, category and a non-default sort", () => {
    expect(recurringHref(null, { category: null, sort: "next" })).toBe("/recurring");
    expect(recurringHref("a1", { category: "c1", sort: "yearly" })).toBe("/recurring?account=a1&category=c1&sort=yearly");
  });
});
