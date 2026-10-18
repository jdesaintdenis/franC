import { describe, expect, it } from "vitest";

import { centsToEuroInput, matchingSplitParts, remainderState, splitCategoryFilter } from "./editor";

const tree = [
  { id: "food", name: "Food", color: "#000", parentId: null },
  { id: "groceries", name: "Groceries", color: "#000", parentId: "food" },
  { id: "home", name: "Home", color: "#000", parentId: null },
];
const parts = [
  { category: { id: "groceries" }, amountCents: -3210 },
  { category: { id: "home" }, amountCents: -1000 },
  { category: null, amountCents: -240 },
];

describe("splitCategoryFilter / matchingSplitParts", () => {
  it("matches nothing without a filter", () => {
    expect(splitCategoryFilter(undefined, tree)).toBeNull();
    expect(matchingSplitParts(parts, null)).toEqual([]);
  });

  it("matches a subcategory exactly and a parent through its subcategories", () => {
    expect(matchingSplitParts(parts, splitCategoryFilter("groceries", tree))).toEqual([parts[0]]);
    expect(matchingSplitParts(parts, splitCategoryFilter("food", tree))).toEqual([parts[0]]);
    expect(matchingSplitParts(parts, splitCategoryFilter("home", tree))).toEqual([parts[1]]);
  });

  it("matches only parts that lost their category for none", () => {
    expect(matchingSplitParts(parts, splitCategoryFilter("none", tree))).toEqual([parts[2]]);
  });
});

describe("centsToEuroInput", () => {
  it("formats with the locale's separator and two decimals", () => {
    expect(centsToEuroInput(4450, "fr")).toBe("44,50");
    expect(centsToEuroInput(-4450, "en")).toBe("44.50");
    expect(centsToEuroInput(5, "en")).toBe("0.05");
    expect(centsToEuroInput(1200, "fr")).toBe("12,00");
  });
});

describe("remainderState", () => {
  it("is left when parts fall short, whatever the sign of the row", () => {
    expect(remainderState(-4450, -1240)).toEqual({ kind: "left", cents: 1240 });
    expect(remainderState(4450, 1240)).toEqual({ kind: "left", cents: 1240 });
  });

  it("is over when parts exceed the total", () => {
    expect(remainderState(-4450, 300)).toEqual({ kind: "over", cents: 300 });
    expect(remainderState(4450, -300)).toEqual({ kind: "over", cents: 300 });
  });

  it("is balanced at zero", () => {
    expect(remainderState(-4450, 0)).toEqual({ kind: "balanced" });
  });
});
