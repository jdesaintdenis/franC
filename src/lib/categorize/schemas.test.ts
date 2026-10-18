import { describe, expect, it } from "vitest";

import { categoryInput, ruleInput } from "./schemas";

const CAT = "3f0c1f0e-6b1e-4f3a-8a3e-0c8d3f5b7a11";

describe("categoryInput", () => {
  it("trims the name and lowercases the color", () => {
    expect(categoryInput.parse({ name: "  Pets  ", color: "#AABBCC" })).toEqual({
      name: "Pets",
      color: "#aabbcc",
    });
  });

  it("accepts a hex colour without # and in any case", () => {
    expect(categoryInput.parse({ name: "Pets", color: "AABBCC" }).color).toBe("#aabbcc");
  });

  it("rejects empty or too long names and bad colors", () => {
    expect(categoryInput.safeParse({ name: "   ", color: "#aabbcc" }).success).toBe(false);
    expect(categoryInput.safeParse({ name: "x".repeat(51), color: "#aabbcc" }).success).toBe(false);
    expect(categoryInput.safeParse({ name: "Pets", color: "red" }).success).toBe(false);
    expect(categoryInput.safeParse({ name: "Pets", color: "#abc" }).success).toBe(false);
  });
});

describe("validation codes", () => {
  const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
    result.error?.issues.map((i) => i.message) ?? [];

  it("reports codes, not English text, for category input", () => {
    expect(messages(categoryInput.safeParse({ name: "   ", color: "#aabbcc" }))).toEqual(["name_required"]);
    expect(messages(categoryInput.safeParse({ name: "x".repeat(51), color: "#aabbcc" }))).toEqual(["name_too_long"]);
    expect(messages(categoryInput.safeParse({ name: "Pets", color: "red" }))).toEqual(["color_invalid"]);
    expect(messages(categoryInput.safeParse({ name: "Pets", color: 123 }))).toEqual(["color_invalid"]);
  });

  it("reports codes for rule input", () => {
    const base = { categoryId: CAT, matchType: "contains", pattern: "a" };
    expect(messages(ruleInput.safeParse({ ...base, categoryId: "nope" }))).toEqual(["category_invalid"]);
    expect(messages(ruleInput.safeParse({ ...base, matchType: "starts" }))).toEqual(["match_type_invalid"]);
    expect(messages(ruleInput.safeParse({ ...base, pattern: "a".repeat(201) }))).toEqual(["pattern_too_long"]);
    expect(messages(ruleInput.safeParse({ ...base, pattern: "  " }))).toContain("pattern_required");
    expect(messages(ruleInput.safeParse({ ...base, matchType: "regex", pattern: "(oops" }))).toEqual(["regex_invalid"]);
  });
});

describe("ruleInput", () => {
  it("accepts a valid contains rule and trims the pattern", () => {
    expect(
      ruleInput.parse({
        categoryId: CAT,
        matchType: "contains",
        pattern: " ORANGE ",
      }).pattern,
    ).toBe("ORANGE");
  });

  it("rejects a non-uuid category, unknown match type and long patterns", () => {
    expect(
      ruleInput.safeParse({
        categoryId: "nope",
        matchType: "contains",
        pattern: "a",
      }).success,
    ).toBe(false);
    expect(
      ruleInput.safeParse({
        categoryId: CAT,
        matchType: "starts",
        pattern: "a",
      }).success,
    ).toBe(false);
    expect(
      ruleInput.safeParse({
        categoryId: CAT,
        matchType: "contains",
        pattern: "a".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("rejects a regex that does not compile", () => {
    expect(
      ruleInput.safeParse({
        categoryId: CAT,
        matchType: "regex",
        pattern: "(oops",
      }).success,
    ).toBe(false);
    expect(
      ruleInput.safeParse({
        categoryId: CAT,
        matchType: "regex",
        pattern: "^or(ange)?$",
      }).success,
    ).toBe(true);
  });

  it("rejects contains/equals patterns that are empty once normalized", () => {
    expect(
      ruleInput.safeParse({
        categoryId: CAT,
        matchType: "contains",
        pattern: "́",
      }).success,
    ).toBe(false);
    expect(
      ruleInput.safeParse({
        categoryId: CAT,
        matchType: "equals",
        pattern: "   ",
      }).success,
    ).toBe(false);
  });
});
