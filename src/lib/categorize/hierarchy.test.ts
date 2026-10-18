import { describe, expect, it } from "vitest";

import {
  buildCategoryTree,
  CATEGORY_PATH_SEPARATOR,
  coveredCategoryIds,
  orderedCategoryOptions,
  validateParent,
  type CategoryNode,
} from "./hierarchy";

const node = (id: string, name: string, parentId: string | null = null): CategoryNode => ({
  id,
  name,
  color: "#000000",
  parentId,
});

const housing = node("housing", "Housing");
const furniture = node("furniture", "Furniture", "housing");
const rent = node("rent", "Rent", "housing");
const transport = node("transport", "Transport");
const all = [transport, rent, furniture, housing];

describe("validateParent", () => {
  it("allows top level for anything", () => {
    expect(validateParent(all, null, null)).toEqual({ ok: true });
    expect(validateParent(all, "furniture", null)).toEqual({ ok: true });
    expect(validateParent(all, "housing", null)).toEqual({ ok: true });
  });

  it("allows a new or childless category under a top-level parent", () => {
    expect(validateParent(all, null, "housing")).toEqual({ ok: true });
    expect(validateParent(all, "transport", "housing")).toEqual({ ok: true });
    expect(validateParent(all, "furniture", "transport")).toEqual({ ok: true });
  });

  it("rejects self, unknown and subcategory parents", () => {
    expect(validateParent(all, "housing", "housing")).toEqual({ ok: false, code: "parent_is_self" });
    expect(validateParent(all, null, "nope")).toEqual({ ok: false, code: "parent_not_found" });
    expect(validateParent(all, null, "furniture")).toEqual({ ok: false, code: "parent_is_subcategory" });
    expect(validateParent(all, "transport", "rent")).toEqual({ ok: false, code: "parent_is_subcategory" });
  });

  it("rejects moving a category with subcategories under a parent (no cycles, depth 2)", () => {
    expect(validateParent(all, "housing", "transport")).toEqual({ ok: false, code: "has_subcategories" });
    // A would-be cycle: parent moved under its own child hits the subcategory rule.
    expect(validateParent(all, "housing", "furniture")).toEqual({ ok: false, code: "parent_is_subcategory" });
  });
});

describe("buildCategoryTree", () => {
  it("sorts parents and children by name, accent- and case-insensitively", () => {
    const tree = buildCategoryTree(
      [node("e", "Épargne"), node("d", "divers"), node("a", "Autre"), node("c2", "b", "a"), node("c1", "A", "a")],
      "fr",
    );
    expect(tree.map((t) => t.category.name)).toEqual(["Autre", "divers", "Épargne"]);
    expect(tree[0].children.map((c) => c.name)).toEqual(["A", "b"]);
  });

  it("treats orphans as top-level", () => {
    const tree = buildCategoryTree([node("x", "Lost", "missing"), housing], "en");
    expect(tree.map((t) => t.category.id)).toEqual(["housing", "x"]);
  });
});

describe("orderedCategoryOptions", () => {
  it("lists each parent followed by its children with path labels", () => {
    const options = orderedCategoryOptions(all, "en");
    expect(options.map((o) => o.label)).toEqual([
      "Housing",
      `Housing${CATEGORY_PATH_SEPARATOR}Furniture`,
      `Housing${CATEGORY_PATH_SEPARATOR}Rent`,
      "Transport",
    ]);
    expect(options[1]).toMatchObject({ id: "furniture", parentId: "housing", parentName: "Housing", name: "Furniture" });
    expect(options[0]).toMatchObject({ parentId: null, parentName: null });
  });

  it("prefixes each part with its own icon; a subcategory's stored icon shows", () => {
    const withIcons = [
      { ...housing, icon: "🏠" },
      { ...node("furniture", "Furniture", "housing"), icon: "🛋️" },
      node("rent", "Rent", "housing"),
      node("transport", "Transport", null),
    ];
    const options = orderedCategoryOptions(withIcons, "en");
    expect(options.map((o) => o.label)).toEqual([
      "🏠 Housing",
      `🏠 Housing${CATEGORY_PATH_SEPARATOR}🛋️ Furniture`,
      `🏠 Housing${CATEGORY_PATH_SEPARATOR}Rent`,
      "Transport",
    ]);
    expect(options.map((o) => o.icon)).toEqual(["🏠", "🛋️", null, null]);
  });

  it("presents orphans as plain top-level options", () => {
    expect(orderedCategoryOptions([node("x", "Lost", "missing")], "en")).toEqual([
      { id: "x", name: "Lost", color: "#000000", icon: null, parentId: null, parentName: null, label: "Lost" },
    ]);
  });
});

describe("coveredCategoryIds", () => {
  it("returns the id plus its children", () => {
    expect(coveredCategoryIds(all, "housing").sort()).toEqual(["furniture", "housing", "rent"]);
  });
  it("returns just the id for a subcategory or childless category", () => {
    expect(coveredCategoryIds(all, "furniture")).toEqual(["furniture"]);
    expect(coveredCategoryIds(all, "transport")).toEqual(["transport"]);
  });
});
