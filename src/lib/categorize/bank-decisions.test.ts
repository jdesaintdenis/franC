import { describe, expect, it } from "vitest";

import type { BankPlan, BankPlanItem } from "./bank";
import {
  decisionToSelectValue,
  effectiveDecisions,
  parseBankDecisions,
  selectValueToDecision,
  summarizeDecisions,
  withCreateDefaults,
} from "./bank-decisions";

const ID = "6f1b3c1e-8a5b-4f43-9d55-0d3b2f1a7c11";
const item = (key: string, suggested: string | null = null): BankPlanItem => ({
  key,
  bankCategory: key,
  bankSubcategory: null,
  rowCount: 1,
  suggestedCategoryId: suggested,
});
const plan: BankPlan = {
  groups: [
    { bankCategory: "A", rowCount: 3, decided: false, storedCategoryId: null, category: item("a", ID), subcategories: [item("a1"), item("a2")] },
    { bankCategory: "B", rowCount: 1, decided: true, storedCategoryId: null, category: null, subcategories: [item("b1")] },
  ],
};

describe("parseBankDecisions", () => {
  it("accepts valid decisions and an empty field", () => {
    expect(parseBankDecisions(JSON.stringify({ a: { action: "map", categoryId: ID }, b: { action: "ignore" } }))).toEqual({
      a: { action: "map", categoryId: ID },
      b: { action: "ignore" },
    });
    expect(parseBankDecisions(null)).toEqual({});
  });
  it("rejects bad JSON, bad shapes and oversized input", () => {
    expect(parseBankDecisions("{")).toBeNull();
    expect(parseBankDecisions(JSON.stringify({ a: { action: "map", categoryId: "x" } }))).toBeNull();
    expect(parseBankDecisions(JSON.stringify({ a: { action: "nuke" } }))).toBeNull();
    const big = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`k${i}`, { action: "create" }]));
    expect(parseBankDecisions(JSON.stringify(big))).toBeNull();
    expect(parseBankDecisions(42)).toBeNull();
  });
});

describe("effectiveDecisions and summary", () => {
  it("pre-maps suggestions unless overridden", () => {
    expect(effectiveDecisions(plan, {})).toEqual({ a: { action: "map", categoryId: ID } });
    expect(effectiveDecisions(plan, { a: null })).toEqual({});
  });
  it("counts each state", () => {
    const d = effectiveDecisions(plan, { a1: { action: "create" }, b1: { action: "ignore" } });
    expect(summarizeDecisions(plan, d)).toEqual({ create: 1, map: 1, ignore: 1, undecided: 1 });
  });
});

describe("select values", () => {
  it("round-trips", () => {
    for (const d of [{ action: "create" }, { action: "ignore" }, { action: "map", categoryId: ID }] as const) {
      expect(selectValueToDecision(decisionToSelectValue(d))).toEqual(d);
    }
    expect(selectValueToDecision("")).toBeNull();
  });
});

describe("withCreateDefaults", () => {
  it("creates every item without a suggestion and leaves suggested ones alone", () => {
    const defaults = withCreateDefaults(plan);
    expect(defaults).toEqual({ a1: { action: "create" }, a2: { action: "create" }, b1: { action: "create" } });
    const decisions = effectiveDecisions(plan, defaults);
    expect(decisions.a).toEqual({ action: "map", categoryId: ID });
    expect(summarizeDecisions(plan, decisions).undecided).toBe(0);
  });
  it("lets an explicit undecided override win", () => {
    const decisions = effectiveDecisions(plan, { ...withCreateDefaults(plan), a1: null });
    expect(summarizeDecisions(plan, decisions).undecided).toBe(1);
  });
});
