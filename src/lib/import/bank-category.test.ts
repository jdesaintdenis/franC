import { describe, expect, it } from "vitest";

import { cleanBankCategory } from "./bank-category";

describe("cleanBankCategory", () => {
  it("keeps real categories, trimmed", () => {
    expect(cleanBankCategory({ category: " Alimentation ", subcategory: " Supermarché " })).toEqual({
      category: "Alimentation",
      subcategory: "Supermarché",
    });
  });

  it("maps empty values to null", () => {
    expect(cleanBankCategory({ category: "Loisirs", subcategory: "  " })).toEqual({
      category: "Loisirs",
      subcategory: null,
    });
    expect(cleanBankCategory({ category: "", subcategory: "" })).toEqual({ category: null, subcategory: null });
  });

  it("clears both when the category is a placeholder (accent and case insensitive)", () => {
    expect(cleanBankCategory({ category: "A categoriser - sortie d'argent", subcategory: "X" })).toEqual({
      category: null,
      subcategory: null,
    });
    expect(cleanBankCategory({ category: "à CATÉGORISER - entrée", subcategory: null })).toEqual({
      category: null,
      subcategory: null,
    });
  });

  it("clears only the subcategory when it ends with a placeholder", () => {
    expect(cleanBankCategory({ category: "Banque", subcategory: "Paiement CB - a categoriser" })).toEqual({
      category: "Banque",
      subcategory: null,
    });
  });

  it("drops a subcategory that has no category", () => {
    expect(cleanBankCategory({ category: null, subcategory: "Supermarché" })).toEqual({
      category: null,
      subcategory: null,
    });
  });
});
