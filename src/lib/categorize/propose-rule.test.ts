import { describe, expect, it } from "vitest";

import { proposeRule } from "./propose-rule";
import { compileRules } from "./rules";

const base = { merchantName: null, labelNormalized: "CB CARREFOUR 12/09", categoryId: "cat-1" };

describe("proposeRule", () => {
  it("uses the merchant name when the row has one", () => {
    expect(proposeRule({ ...base, merchantName: "Carrefour" }, [])).toEqual({
      matchType: "contains",
      pattern: "Carrefour",
      categoryId: "cat-1",
    });
  });

  it("falls back to the merchant key of a noisy label", () => {
    expect(proposeRule(base, [])).toEqual({ matchType: "contains", pattern: "CARREFOUR", categoryId: "cat-1" });
  });

  it("proposes nothing when the key is too short", () => {
    expect(proposeRule({ ...base, labelNormalized: "CB EP 12/09" }, [])).toBeNull();
  });

  it("proposes nothing when a rule already gives this category", () => {
    const rules = compileRules([
      { id: "r1", categoryId: "cat-1", matchType: "contains", pattern: "carrefour", priority: 0, createdAt: new Date(0) },
    ]);
    expect(proposeRule(base, rules)).toBeNull();
  });

  it("still proposes when an existing rule gives another category", () => {
    const rules = compileRules([
      { id: "r1", categoryId: "cat-2", matchType: "contains", pattern: "carrefour", priority: 0, createdAt: new Date(0) },
    ]);
    expect(proposeRule(base, rules)).not.toBeNull();
  });
});
