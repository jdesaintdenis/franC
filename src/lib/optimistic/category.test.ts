import { describe, expect, it } from "vitest";

import { categoryChangePatch, categoryRefFromOption, findCategoryRef } from "./category";

const option = { id: "c1", name: "Groceries", color: "#0a0", icon: "🛒", parentName: null, parentId: null, label: "🛒 Groceries" };

describe("category change helpers", () => {
  it("keeps only the display fields of an option", () => {
    expect(categoryRefFromOption(option)).toEqual({ id: "c1", name: "Groceries", color: "#0a0", icon: "🛒", parentName: null });
  });

  it("finds a category by id, and gives null for null or an unknown id", () => {
    expect(findCategoryRef([option], "c1")?.name).toBe("Groceries");
    expect(findCategoryRef([option], null)).toBeNull();
    expect(findCategoryRef([option], "nope")).toBeNull();
  });

  it("marks a hand categorization manual and reviewed, and clearing without a source", () => {
    const ref = categoryRefFromOption(option);
    expect(categoryChangePatch(ref)).toEqual({ category: ref, categorySource: "manual", reviewed: true });
    expect(categoryChangePatch(null)).toEqual({ category: null, categorySource: null, reviewed: false });
  });
});
