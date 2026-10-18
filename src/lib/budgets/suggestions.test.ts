import { describe, expect, it } from "vitest";

import {
  buildSuggestionGroups,
  filterSuggestionGroups,
  selectableSuggestions,
  topSuggestions,
  type SuggestionCategory,
} from "./suggestions";

const cat = (id: string, name: string, parentId: string | null = null): SuggestionCategory => ({
  id,
  name,
  color: "#112233",
  parentId,
});

const categories = [
  cat("food", "Food"),
  cat("groceries", "Groceries", "food"),
  cat("restaurants", "Restaurants", "food"),
  cat("home", "Home"),
  cat("rent", "Rent", "home"),
  cat("fun", "Fun"),
  cat("gifts", "Gifts"),
];
const averages = new Map([
  ["food", 90000],
  ["groceries", 60000],
  ["restaurants", 30000],
  ["home", 80000],
  ["rent", 80000],
  ["fun", 5000],
]);
const input = { categories, budgetedIds: new Set<string>(), averages, locale: "en" };

describe("buildSuggestionGroups", () => {
  it("sorts groups and their subcategories by average spending, then name", () => {
    const groups = buildSuggestionGroups(input);
    expect(groups.map((g) => g.parent.category.id)).toEqual(["food", "home", "fun", "gifts"]);
    expect(groups[0].children.map((c) => c.category.id)).toEqual(["groceries", "restaurants"]);
  });

  it("leaves budgeted categories out", () => {
    const groups = buildSuggestionGroups({ ...input, budgetedIds: new Set(["groceries", "fun"]) });
    expect(groups.map((g) => g.parent.category.id)).toEqual(["food", "home", "gifts"]);
    expect(groups[0].children.map((c) => c.category.id)).toEqual(["restaurants"]);
  });

  it("keeps a budgeted parent as a heading while a subcategory has no budget", () => {
    const groups = buildSuggestionGroups({ ...input, budgetedIds: new Set(["food"]) });
    const food = groups.find((g) => g.parent.category.id === "food");
    expect(food?.parent.selectable).toBe(false);
    expect(food?.children).toHaveLength(2);
    // Nothing unbudgeted left under it: the group disappears.
    const none = buildSuggestionGroups({ ...input, budgetedIds: new Set(["food", "groceries", "restaurants"]) });
    expect(none.some((g) => g.parent.category.id === "food")).toBe(false);
  });

  it("puts categories without spending last, by name", () => {
    const groups = buildSuggestionGroups({ ...input, averages: new Map([["fun", 100]]) });
    expect(groups.map((g) => g.parent.category.id)).toEqual(["fun", "food", "gifts", "home"]);
    expect(groups.find((g) => g.parent.category.id === "gifts")?.parent.averageCents).toBe(0);
  });

  it("treats an orphan subcategory as top-level", () => {
    const groups = buildSuggestionGroups({ ...input, categories: [cat("x", "Orphan", "missing")], averages: new Map() });
    expect(groups.map((g) => g.parent.category.id)).toEqual(["x"]);
  });
});

describe("topSuggestions", () => {
  it("returns the biggest selectable spenders, flat, skipping those with no spending", () => {
    const top = topSuggestions({ ...input, limit: 3 });
    expect(top.map((s) => s.category.id)).toEqual(["food", "home", "rent"]);
    expect(topSuggestions({ ...input, averages: new Map(), limit: 3 })).toEqual([]);
  });

  it("skips budgeted categories and headings", () => {
    const top = topSuggestions({ ...input, budgetedIds: new Set(["food"]), limit: 3 });
    expect(top.map((s) => s.category.id)).toEqual(["home", "rent", "groceries"]);
  });
});

describe("selectableSuggestions", () => {
  it("lists parents before their subcategories, headings excluded", () => {
    const groups = buildSuggestionGroups({ ...input, budgetedIds: new Set(["food"]) });
    expect(selectableSuggestions(groups).map((s) => s.category.id)).toEqual([
      "groceries",
      "restaurants",
      "home",
      "rent",
      "fun",
      "gifts",
    ]);
  });
});

describe("filterSuggestionGroups", () => {
  const groups = buildSuggestionGroups(input);

  it("returns everything for an empty query", () => {
    expect(filterSuggestionGroups(groups, "  ", "en")).toHaveLength(groups.length);
  });

  it("matches names regardless of case and keeps the parent of a matching subcategory", () => {
    const result = filterSuggestionGroups(groups, "ROCER", "en");
    expect(result).toHaveLength(1);
    expect(result[0].parent.category.id).toBe("food");
    expect(result[0].children.map((c) => c.category.id)).toEqual(["groceries"]);
  });

  it("keeps all subcategories of a matching parent", () => {
    const result = filterSuggestionGroups(groups, "food", "en");
    expect(result[0].children).toHaveLength(2);
  });
});
