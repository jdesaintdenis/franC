import { describe, expect, it } from "vitest";

import { groupBankMappings } from "./bank-groups";

const m = (bankCategory: string, bankSubcategory: string | null) => ({ bankCategory, bankSubcategory });

describe("groupBankMappings", () => {
  it("puts the own mapping apart and keeps subcategories in order", () => {
    const groups = groupBankMappings([m("A", null), m("A", "a1"), m("A", "a2"), m("B", "b1")]);
    expect(groups).toEqual([
      { bankCategory: "A", own: m("A", null), subcategories: [m("A", "a1"), m("A", "a2")] },
      { bankCategory: "B", own: null, subcategories: [m("B", "b1")] },
    ]);
  });

  it("returns nothing for no mappings", () => {
    expect(groupBankMappings([])).toEqual([]);
  });
});
