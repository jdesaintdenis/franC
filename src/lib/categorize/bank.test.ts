import { describe, expect, it } from "vitest";

import { CATEGORY_PALETTE, subcategoryShade } from "@/lib/category-color";

import {
  bankKey,
  buildBankCategoryWrites,
  buildMappingLookup,
  planBankCategories,
  resolveBankCategory,
  type BankCategoryOption,
  type BankMapping,
  type BankRow,
} from "./bank";

const row = (bankCategory: string | null, bankSubcategory: string | null = null): BankRow => ({
  bankCategory,
  bankSubcategory,
});

const cat = (id: string, name: string, parentId: string | null = null): BankCategoryOption => ({
  id,
  name,
  parentId,
});

const rows: BankRow[] = [
  row("Alimentation", "Restaurant"),
  row("Alimentation", "Restaurant"),
  row("Alimentation", "Hyper"),
  row("Alimentation"),
  row("Transports", "Carburant"),
  row(null),
];

describe("resolveBankCategory", () => {
  const lookup = buildMappingLookup([
    { bankCategory: "A", bankSubcategory: null, categoryId: "cat-a" },
    { bankCategory: "A", bankSubcategory: "A1", categoryId: "cat-a1" },
    { bankCategory: "A", bankSubcategory: "A2", categoryId: null },
    { bankCategory: "B", bankSubcategory: null, categoryId: null },
    { bankCategory: "B", bankSubcategory: "B1", categoryId: "cat-b1" },
  ]);

  it("prefers the subcategory mapping", () => {
    expect(resolveBankCategory(row("A", "A1"), lookup)).toBe("cat-a1");
  });
  it("falls back to the bank category when the subcategory is ignored or unmapped", () => {
    expect(resolveBankCategory(row("A", "A2"), lookup)).toBe("cat-a");
    expect(resolveBankCategory(row("A", "A3"), lookup)).toBe("cat-a");
    expect(resolveBankCategory(row("A"), lookup)).toBe("cat-a");
  });
  it("gives a mapped subcategory of an ignored category its category", () => {
    expect(resolveBankCategory(row("B", "B1"), lookup)).toBe("cat-b1");
    expect(resolveBankCategory(row("B", "B2"), lookup)).toBeNull();
  });
  it("returns null without a bank category or mapping", () => {
    expect(resolveBankCategory(row(null), lookup)).toBeNull();
    expect(resolveBankCategory(row("Z", "Z1"), lookup)).toBeNull();
  });
});

describe("planBankCategories", () => {
  it("lists new categories and subcategories with counts, sorted", () => {
    const plan = planBankCategories(rows, buildMappingLookup([]), []);
    expect(plan.groups.map((g) => g.bankCategory)).toEqual(["Alimentation", "Transports"]);
    const [alim] = plan.groups;
    expect(alim.rowCount).toBe(4);
    expect(alim.decided).toBe(false);
    expect(alim.category).toMatchObject({ rowCount: 4, suggestedCategoryId: null });
    expect(alim.subcategories.map((s) => [s.bankSubcategory, s.rowCount])).toEqual([
      ["Hyper", 1],
      ["Restaurant", 2],
    ]);
  });

  it("only lists unmapped subcategories of a decided category", () => {
    const mappings: BankMapping[] = [
      { bankCategory: "Alimentation", bankSubcategory: null, categoryId: "x" },
      { bankCategory: "Alimentation", bankSubcategory: "Hyper", categoryId: null },
      { bankCategory: "Transports", bankSubcategory: null, categoryId: null },
      { bankCategory: "Transports", bankSubcategory: "Carburant", categoryId: null },
    ];
    const plan = planBankCategories(rows, buildMappingLookup(mappings), []);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toMatchObject({ bankCategory: "Alimentation", decided: true, storedCategoryId: "x", category: null });
    expect(plan.groups[0].subcategories.map((s) => s.bankSubcategory)).toEqual(["Restaurant"]);
  });

  it("suggests same-name categories at the matching place", () => {
    const categories = [
      cat("food", "alimentation"),
      cat("resto", "Restaurant", "food"),
      cat("resto-top", "Restaurant"),
      cat("fuel", " Carburant "),
    ];
    const plan = planBankCategories(rows, buildMappingLookup([]), categories);
    const [alim, transports] = plan.groups;
    expect(alim.category?.suggestedCategoryId).toBe("food");
    expect(alim.subcategories.find((s) => s.bankSubcategory === "Restaurant")?.suggestedCategoryId).toBe("resto");
    expect(alim.subcategories.find((s) => s.bankSubcategory === "Hyper")?.suggestedCategoryId).toBeNull();
    // No suggested target for Transports: its subcategory is matched at top level.
    expect(transports.category?.suggestedCategoryId).toBeNull();
    expect(transports.subcategories[0].suggestedCategoryId).toBe("fuel");
  });

  it("uses the stored target as the place for subcategory suggestions", () => {
    const categories = [cat("food", "Nourriture"), cat("resto", "Restaurant", "food"), cat("resto-top", "Restaurant")];
    const lookup = buildMappingLookup([{ bankCategory: "Alimentation", bankSubcategory: null, categoryId: "food" }]);
    const plan = planBankCategories(rows, lookup, categories);
    expect(plan.groups[0].subcategories.find((s) => s.bankSubcategory === "Restaurant")?.suggestedCategoryId).toBe("resto");
  });
});

describe("buildBankCategoryWrites", () => {
  const plan = planBankCategories(rows, buildMappingLookup([]), []);
  const key = {
    alim: bankKey("Alimentation", null),
    resto: bankKey("Alimentation", "Restaurant"),
    hyper: bankKey("Alimentation", "Hyper"),
    transports: bankKey("Transports", null),
    fuel: bankKey("Transports", "Carburant"),
  };
  const build = (decisions: Parameters<typeof buildBankCategoryWrites>[1], categories: BankCategoryOption[] = [], p = plan) => {
    const result = buildBankCategoryWrites(p, decisions, categories);
    if (!result.ok) throw new Error(result.code);
    return result.writes;
  };

  it("creates nothing for undecided items", () => {
    expect(build({})).toEqual({ create: [], mappings: [] });
  });

  it("ignores decisions for keys outside the plan", () => {
    expect(build({ [bankKey("Nope", null)]: { action: "create" } })).toEqual({ create: [], mappings: [] });
  });

  it("creates everything, subcategories under the created category, parents first", () => {
    const decisions = Object.fromEntries(
      plan.groups.flatMap((g) => [g.category!, ...g.subcategories]).map((i) => [i.key, { action: "create" as const }]),
    );
    const writes = build(decisions);
    expect(writes.create.map((c) => [c.name, c.parentKey])).toEqual([
      ["Alimentation", null],
      ["Hyper", key.alim],
      ["Restaurant", key.alim],
      ["Transports", null],
      ["Carburant", key.transports],
    ]);
    // Top-level categories take the palette in order; subcategories are shades of their parent.
    expect(writes.create.map((c) => c.color)).toEqual([
      CATEGORY_PALETTE[0],
      subcategoryShade(CATEGORY_PALETTE[0], 0),
      subcategoryShade(CATEGORY_PALETTE[0], 1),
      CATEGORY_PALETTE[1],
      subcategoryShade(CATEGORY_PALETTE[1], 0),
    ]);
    expect(writes.create.map((c) => c.icon)).toEqual(["🛒", null, null, "🚗", null]);
    expect(writes.mappings).toHaveLength(5);
    expect(writes.mappings[0]).toEqual({
      bankCategory: "Alimentation",
      bankSubcategory: null,
      target: { kind: "created", createKey: key.alim },
    });
  });

  it("cycles the palette", () => {
    const many: BankRow[] = Array.from({ length: 14 }, (_, i) => row(`C${String(i).padStart(2, "0")}`));
    const p = planBankCategories(many, buildMappingLookup([]), []);
    const writes = build(Object.fromEntries(p.groups.map((g) => [g.category!.key, { action: "create" as const }])), [], p);
    expect(writes.create[12].color).toBe(CATEGORY_PALETTE[0]);
  });

  it("creates subcategories under the mapped top-level category", () => {
    const writes = build(
      { [key.alim]: { action: "map", categoryId: "food" }, [key.hyper]: { action: "create" } },
      [cat("food", "Food")],
    );
    expect(writes.create).toEqual([expect.objectContaining({ name: "Hyper", parentId: "food", parentKey: null })]);
  });

  it("creates subcategories under the parent of a mapped subcategory", () => {
    const writes = build(
      { [key.alim]: { action: "map", categoryId: "resto" }, [key.hyper]: { action: "create" } },
      [cat("food", "Food"), cat("resto", "Resto", "food")],
    );
    expect(writes.create).toEqual([expect.objectContaining({ name: "Hyper", parentId: "food" })]);
  });

  it("creates subcategories top-level when the category is ignored or undecided", () => {
    for (const decisions of [
      { [key.alim]: { action: "ignore" as const }, [key.hyper]: { action: "create" as const } },
      { [key.hyper]: { action: "create" as const } },
    ]) {
      const writes = build(decisions);
      expect(writes.create).toEqual([expect.objectContaining({ name: "Hyper", parentId: null, parentKey: null })]);
    }
  });

  it("uses the stored target of a decided category", () => {
    const lookup = buildMappingLookup([{ bankCategory: "Alimentation", bankSubcategory: null, categoryId: "food" }]);
    const p = planBankCategories(rows, lookup, [cat("food", "Food")]);
    const writes = build({ [key.hyper]: { action: "create" } }, [cat("food", "Food")], p);
    expect(writes.create).toEqual([expect.objectContaining({ name: "Hyper", parentId: "food" })]);
    expect(writes.mappings).toEqual([
      { bankCategory: "Alimentation", bankSubcategory: "Hyper", target: { kind: "created", createKey: key.hyper } },
    ]);
  });

  it("reuses an existing category with the same name at that place", () => {
    const categories = [cat("food", "alimentation"), cat("hyper", "Hyper", "food"), cat("hyper-top", "Hyper")];
    const p = planBankCategories(rows, buildMappingLookup([]), categories);
    const writes = build({ [key.alim]: { action: "create" }, [key.hyper]: { action: "create" } }, categories, p);
    expect(writes.create).toEqual([]);
    expect(writes.mappings.map((m) => m.target)).toEqual([
      { kind: "category", categoryId: "food" },
      { kind: "category", categoryId: "hyper" },
    ]);
  });

  it("stores ignored mappings as such", () => {
    const writes = build({ [key.transports]: { action: "ignore" } });
    expect(writes.mappings).toEqual([{ bankCategory: "Transports", bankSubcategory: null, target: { kind: "ignored" } }]);
  });

  it("rejects an unknown category id", () => {
    const result = buildBankCategoryWrites(plan, { [key.alim]: { action: "map", categoryId: "other-user" } }, [cat("food", "Food")]);
    expect(result).toEqual({ ok: false, code: "category_not_found" });
  });
});
