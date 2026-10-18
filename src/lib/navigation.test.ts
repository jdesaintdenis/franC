import { describe, expect, it } from "vitest";

import { activeSection, TAB_SECTIONS } from "./navigation";

describe("TAB_SECTIONS", () => {
  it("is the same five tabs for everyone", () => {
    expect(TAB_SECTIONS).toEqual([
      "home",
      "transactions",
      "plan",
      "accounts",
      "more",
    ]);
  });
});

describe("activeSection", () => {
  it.each([
    ["/", "home"],
    ["/transactions", "transactions"],
    ["/transactions?category=x", "transactions"],
    ["/review", "transactions"],
    ["/import", "accounts"],
    ["/import/x", "accounts"],
    ["/accounts?edit=x", "accounts"],
    ["/accounts/bank", "accounts"],
    ["/budget", "plan"],
    ["/settings/budgets", "plan"],
    ["/settings/goals", "plan"],
    ["/recurring", "plan"],
    ["/budget/next-month", "plan"],
    ["/year", "plan"],
    ["/settings", "more"],
    ["/settings/", "more"],
    ["/settings/rules", "more"],
    ["/accounts", "accounts"],
    ["/settings/bank-categories", "more"],
  ] as const)("%s belongs to %s", (path, section) => {
    expect(activeSection(path)).toBe(section);
  });

  it("does not match on a shared prefix", () => {
    expect(activeSection("/yearly")).toBeNull();
    expect(activeSection("/settings/budgetsx")).toBe("more");
    expect(activeSection("/reviewer")).toBeNull();
  });

  it("returns null outside the navigation", () => {
    expect(activeSection("/offline")).toBeNull();
    expect(activeSection("/login")).toBeNull();
  });
});

describe("old addresses", () => {
  it("no longer knows the old Budget and Ce mois-ci addresses", () => {
    expect(activeSection("/plan")).toBeNull();
    expect(activeSection("/month")).toBeNull();
  });
});
