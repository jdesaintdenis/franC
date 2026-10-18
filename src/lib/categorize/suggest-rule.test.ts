import { describe, expect, it } from "vitest";

import { compileRules } from "./rules";
import {
  suggestionForRow,
  suggestRules,
  SUGGESTION_LIMIT,
  type SuggestionDismissal,
  type SuggestionRow,
} from "./suggest-rule";

const FOOD = "cat-food";
const RESTO = "cat-resto";

function row(label: string, over: Partial<SuggestionRow> = {}): SuggestionRow {
  return { categoryId: FOOD, merchantId: null, merchantName: null, labelNormalized: label, ...over };
}
function bakery(n: number, over: Partial<SuggestionRow> = {}): SuggestionRow[] {
  return Array.from({ length: n }, (_, i) => row(`CB BOULANGERIE DES L FACT 2509${10 + i}`, over));
}
const none = compileRules([]);
const noDismissals: SuggestionDismissal[] = [];

describe("suggestRules", () => {
  it("needs 3 rows", () => {
    expect(suggestRules(bakery(2), none, noDismissals)).toEqual([]);
    const [s] = suggestRules(bakery(3), none, noDismissals);
    expect(s).toEqual({
      matchType: "contains",
      pattern: "BOULANGERIE DES L",
      categoryId: FOOD,
      count: 3,
      merchantId: null,
    });
  });

  it("is blocked by a conflicting manual row of the group", () => {
    expect(suggestRules([...bakery(3), ...bakery(1, { categoryId: RESTO })], none, noDismissals)).toEqual([]);
  });

  it("is blocked by an existing rule matching a label", () => {
    const rules = compileRules([
      { id: "r1", categoryId: FOOD, matchType: "contains", pattern: "BOULANGERIE", priority: 0, createdAt: new Date(0) },
    ]);
    expect(suggestRules(bakery(3), rules, noDismissals)).toEqual([]);
  });

  it("is blocked by a dismissal, but only the same pattern and category", () => {
    const d = { matchType: "contains", pattern: "BOULANGERIE DES L", categoryId: FOOD };
    expect(suggestRules(bakery(3), none, [d])).toEqual([]);
    expect(suggestRules(bakery(3), none, [{ ...d, categoryId: RESTO }])).toHaveLength(1);
  });

  it("uses equals <merchant name> for merchant groups", () => {
    const rows = [
      row("CB BOULANGERIE DES L FACT 250901", { merchantId: "m1", merchantName: "Boulangerie Dupont" }),
      row("CB PAIN DORE FACT 250902", { merchantId: "m1", merchantName: "Boulangerie Dupont" }),
      row("PRLV BOULANGERIE DUPONT", { merchantId: "m1", merchantName: "Boulangerie Dupont" }),
    ];
    const [s] = suggestRules(rows, none, noDismissals);
    expect(s).toMatchObject({ matchType: "equals", pattern: "Boulangerie Dupont", merchantId: "m1", count: 3 });
  });

  it("rejects keys shorter than 3 characters", () => {
    const rows = [row("CB AB FACT 250901"), row("CB AB FACT 250902"), row("CB AB FACT 250903")];
    expect(suggestRules(rows, none, noDismissals)).toEqual([]);
  });

  it("sorts by group size and caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      Array.from({ length: 3 + (i === 5 ? 2 : 0) }, () => row(`CB SHOP${String.fromCharCode(65 + i)}${i} FACT 250901`)),
    ).flat();
    const list = suggestRules(many, none, noDismissals);
    expect(list).toHaveLength(SUGGESTION_LIMIT);
    expect(list[0].count).toBe(5);
  });
});

describe("suggestionForRow", () => {
  it("only looks at the group of the row", () => {
    const rows = [...bakery(3), ...bakery(1, { categoryId: RESTO, labelNormalized: "CB SUSHI SHOP FACT 250901" })];
    expect(suggestionForRow(rows[0], rows, none, noDismissals)?.count).toBe(3);
    expect(suggestionForRow(rows[3], rows, none, noDismissals)).toBeNull();
  });
});
