import { describe, expect, it } from "vitest";

import { matchSavingsRule, savingsRulePattern, type SavingsRuleInput } from "./rules";

const rule = (over: Partial<SavingsRuleInput>): SavingsRuleInput => ({
  id: "r1",
  accountId: "a1",
  goalId: null,
  matchType: "contains",
  pattern: "VIR LIVRET A",
  createdAt: new Date("2026-10-01T10:00:00Z"),
  ...over,
});
const row = (createdAt: string, normalized = "VIR LIVRET A 0910") => ({
  createdAt: new Date(createdAt),
  labels: { normalized, display: null },
});

describe("savingsRulePattern", () => {
  it("prefers the merchant name, else the merchant key", () => {
    expect(savingsRulePattern("Livret A", "VIR LIVRET A 0910")).toBe("Livret A");
    expect(savingsRulePattern(null, "VIR LIVRET A 0910")).toBe("LIVRET A");
  });
  it("is null when too short", () => {
    expect(savingsRulePattern("ab", "AB")).toBeNull();
  });
});

describe("matchSavingsRule", () => {
  it("matches a row inserted after the rule, ignoring accents and case", () => {
    expect(matchSavingsRule([rule({ pattern: "vir livret à" })], row("2026-10-02T00:00:00Z"))).toEqual({ accountId: "a1", goalId: null });
  });
  it("never matches a row older than the rule", () => {
    expect(matchSavingsRule([rule({})], row("2026-09-30T00:00:00Z"))).toBeNull();
  });
  it("lets the oldest matching rule win", () => {
    const older = rule({ id: "r2", accountId: "a2", createdAt: new Date("2026-09-01T00:00:00Z") });
    expect(matchSavingsRule([rule({}), older], row("2026-10-02T00:00:00Z"))).toEqual({ accountId: "a2", goalId: null });
  });
  it("returns the goal of the matching rule", () => {
    expect(matchSavingsRule([rule({ goalId: "g1" })], row("2026-10-02T00:00:00Z"))).toEqual({ accountId: "a1", goalId: "g1" });
  });
  it("returns null without a match", () => {
    expect(matchSavingsRule([rule({})], row("2026-10-02T00:00:00Z", "CARREFOUR"))).toBeNull();
  });
});
