import { describe, expect, it } from "vitest";

import { categorizeLabel, compileRules, matchesRule, sortRules, type RuleInput } from "./rules";

const ORANGE = { normalized: "PRLV ORANGE BOX", display: "ORANGE" };
const VETO = {
  normalized: "CB CLINIQUE ANIMALE FACT 250925",
  display: "Clinique Vétérinaire",
};
const SNACK = {
  normalized: "CB SNACK DU PORT FACT 250925",
  display: "Snack du Port",
};

let seq = 0;
function rule(overrides: Partial<RuleInput> & Pick<RuleInput, "matchType" | "pattern">): RuleInput {
  seq += 1;
  return {
    id: `rule-${String(seq).padStart(3, "0")}`,
    categoryId: `cat-${seq}`,
    priority: 0,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("matchesRule", () => {
  it("contains is case- and accent-insensitive", () => {
    expect(matchesRule({ matchType: "contains", pattern: "orange" }, ORANGE)).toBe(true);
    expect(matchesRule({ matchType: "contains", pattern: "véterinaire" }, VETO)).toBe(true);
    expect(matchesRule({ matchType: "contains", pattern: "free" }, ORANGE)).toBe(false);
  });

  it("equals needs the whole label", () => {
    expect(matchesRule({ matchType: "equals", pattern: "Orange" }, ORANGE)).toBe(true);
    expect(matchesRule({ matchType: "equals", pattern: "prlv orange box" }, ORANGE)).toBe(true);
    expect(matchesRule({ matchType: "equals", pattern: "PRLV ORANGE" }, ORANGE)).toBe(false);
  });

  it("matches through the display label when the raw label does not", () => {
    expect(matchesRule({ matchType: "contains", pattern: "vétérinaire" }, VETO)).toBe(true);
    expect(matchesRule({ matchType: "contains", pattern: "clinique" }, VETO)).toBe(true);
  });

  it("regex is case-insensitive and tested against both labels", () => {
    expect(matchesRule({ matchType: "regex", pattern: "^cb snack .* fact" }, SNACK)).toBe(true);
    expect(matchesRule({ matchType: "regex", pattern: "^clinique v[eé]t" }, VETO)).toBe(true);
    expect(matchesRule({ matchType: "regex", pattern: "^snack$" }, SNACK)).toBe(false);
  });

  it("never matches an invalid regex and never throws", () => {
    expect(matchesRule({ matchType: "regex", pattern: "(unclosed" }, ORANGE)).toBe(false);
  });

  it("handles null labels", () => {
    const none = { normalized: null, display: null };
    expect(matchesRule({ matchType: "contains", pattern: "orange" }, none)).toBe(false);
    expect(matchesRule({ matchType: "regex", pattern: ".*" }, none)).toBe(false);
    expect(
      matchesRule({ matchType: "contains", pattern: "orange" }, { normalized: null, display: "Orange" }),
    ).toBe(true);
    expect(
      matchesRule({ matchType: "equals", pattern: "orange" }, { normalized: "ORANGE", display: null }),
    ).toBe(true);
  });

  it("an empty pattern matches nothing", () => {
    expect(matchesRule({ matchType: "contains", pattern: "  " }, ORANGE)).toBe(false);
  });
});

describe("sortRules", () => {
  it("orders by priority, then createdAt, then id", () => {
    const a = rule({ matchType: "contains", pattern: "a", priority: 1 });
    const b = rule({
      matchType: "contains",
      pattern: "b",
      priority: 0,
      createdAt: new Date("2025-02-01"),
    });
    const c = rule({
      matchType: "contains",
      pattern: "c",
      priority: 0,
      createdAt: new Date("2025-01-15"),
    });
    const d = rule({
      matchType: "contains",
      pattern: "d",
      priority: 0,
      createdAt: new Date("2025-01-15"),
    });
    expect(sortRules([a, b, d, c]).map((r) => r.pattern)).toEqual(["c", "d", "b", "a"]);
  });

  it("does not mutate its input", () => {
    const rules = [
      rule({ matchType: "contains", pattern: "x", priority: 2 }),
      rule({ matchType: "contains", pattern: "y" }),
    ];
    sortRules(rules);
    expect(rules[0].pattern).toBe("x");
  });
});

describe("categorizeLabel", () => {
  it("first match by priority wins", () => {
    const rules = compileRules([
      rule({
        matchType: "contains",
        pattern: "CB",
        categoryId: "generic",
        priority: 5,
      }),
      rule({
        matchType: "contains",
        pattern: "SNACK",
        categoryId: "dining",
        priority: 1,
      }),
    ]);
    expect(categorizeLabel(rules, SNACK)).toBe("dining");
    expect(categorizeLabel(rules, VETO)).toBe("generic");
  });

  it("ties on priority go to the older rule", () => {
    const rules = compileRules([
      rule({
        matchType: "contains",
        pattern: "ORANGE",
        categoryId: "newer",
        createdAt: new Date("2025-03-01"),
      }),
      rule({
        matchType: "contains",
        pattern: "ORANGE",
        categoryId: "older",
        createdAt: new Date("2025-02-01"),
      }),
    ]);
    expect(categorizeLabel(rules, ORANGE)).toBe("older");
  });

  it("skips invalid regexes and returns null when nothing matches", () => {
    const rules = compileRules([
      rule({
        matchType: "regex",
        pattern: "[",
        categoryId: "broken",
        priority: 0,
      }),
      rule({
        matchType: "contains",
        pattern: "orange",
        categoryId: "telecom",
        priority: 1,
      }),
    ]);
    expect(categorizeLabel(rules, ORANGE)).toBe("telecom");
    expect(categorizeLabel(rules, VETO)).toBeNull();
  });
});

describe("starts_with", () => {
  it("matches the start of either label, ignoring case and accents", () => {
    expect(matchesRule({ matchType: "starts_with", pattern: "prlv orange" }, ORANGE)).toBe(true);
    expect(matchesRule({ matchType: "starts_with", pattern: "clinique vet" }, VETO)).toBe(true);
    expect(matchesRule({ matchType: "starts_with", pattern: "orange box" }, ORANGE)).toBe(false);
  });

  it("never matches an empty pattern", () => {
    expect(matchesRule({ matchType: "starts_with", pattern: "  " }, ORANGE)).toBe(false);
  });
});

describe("merchant name as a candidate", () => {
  const named = { ...ORANGE, merchant: "Orange Mobile" };

  it("lets contains, equals and starts_with rules match the merchant name", () => {
    expect(matchesRule({ matchType: "contains", pattern: "mobile" }, named)).toBe(true);
    expect(matchesRule({ matchType: "equals", pattern: "orange mobile" }, named)).toBe(true);
    expect(matchesRule({ matchType: "starts_with", pattern: "orange m" }, named)).toBe(true);
  });

  it("lets a regex rule match it, and ignores it when absent", () => {
    expect(matchesRule({ matchType: "regex", pattern: "^Orange Mobile$" }, named)).toBe(true);
    expect(matchesRule({ matchType: "contains", pattern: "mobile" }, ORANGE)).toBe(false);
    expect(matchesRule({ matchType: "contains", pattern: "mobile" }, { ...ORANGE, merchant: null })).toBe(false);
  });
});
