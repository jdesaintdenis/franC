import { describe, expect, it } from "vitest";

import { canCreateFromSearch, defaultCreateParentId, optionForCreated } from "./picker-create";

const node = (id: string, name: string, parentId: string | null = null) => ({ id, name, color: "#112233", icon: null, parentId });
const TREE = [
  node("f", "Food"),
  node("g1", "Groceries", "f"),
  node("r1", "Restaurants", "f"),
  node("e1", "Épicerie", "f"),
  node("t", "Transport"),
  node("gas", "Gas", "t"),
];

describe("canCreateFromSearch", () => {
  it("is false on an exact name, ignoring accents and case", () => {
    expect(canCreateFromSearch(["Épicerie"], "epicerie")).toBe(false);
    expect(canCreateFromSearch(["Épicerie"], "  EPICERIE ")).toBe(false);
  });
  it("is true for a partial or new name", () => {
    expect(canCreateFromSearch(["Épicerie"], "Epic")).toBe(true);
    expect(canCreateFromSearch([], "Courses")).toBe(true);
  });
  it("is false for an empty search", () => {
    expect(canCreateFromSearch(["Food"], "")).toBe(false);
    expect(canCreateFromSearch(["Food"], "   ")).toBe(false);
  });
  it("counts the extra rows (Uncategorized)", () => {
    expect(canCreateFromSearch(["Courses"], "uncategorized", ["Uncategorized"])).toBe(false);
  });
});

describe("defaultCreateParentId", () => {
  it("picks the one parent when only its subcategories match", () => {
    expect(defaultCreateParentId(TREE, "groc")).toBe("f");
    expect(defaultCreateParentId(TREE, "restau")).toBe("f");
    expect(defaultCreateParentId(TREE, "EPI")).toBe("f");
  });
  it("is top level when a top-level category matches", () => {
    expect(defaultCreateParentId(TREE, "food")).toBeNull();
  });
  it("is top level when matches span two parents", () => {
    expect(defaultCreateParentId(TREE, "g")).toBeNull();
  });
  it("is top level without a match or search", () => {
    expect(defaultCreateParentId(TREE, "zzz")).toBeNull();
    expect(defaultCreateParentId(TREE, "")).toBeNull();
  });
});

describe("optionForCreated", () => {
  it("labels a subcategory with its parent", () => {
    const option = optionForCreated(node("n", "Bakery", "f"), TREE, "en");
    expect(option.parentName).toBe("Food");
    expect(option.label).toContain("Food > ");
  });
  it("keeps a top-level one without a parent", () => {
    const option = optionForCreated(node("n", "Pets"), TREE, "en");
    expect(option.parentId).toBeNull();
    expect(option.parentName).toBeNull();
  });
});
