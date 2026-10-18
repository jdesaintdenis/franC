import { describe, expect, it } from "vitest";

import { isEmailAllowed } from "./allowlist";

describe("isEmailAllowed", () => {
  it("allows an email present in the list", () => {
    expect(isEmailAllowed("owner@example.com", "owner@example.com,e2e@example.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isEmailAllowed("Owner@Example.com", "owner@example.com")).toBe(true);
    expect(isEmailAllowed("owner@example.com", "OWNER@EXAMPLE.COM")).toBe(true);
  });

  it("trims whitespace around list entries and the input email", () => {
    expect(isEmailAllowed("  owner@example.com  ", " owner@example.com , e2e@example.com ")).toBe(
      true,
    );
  });

  it("denies an email not in the list", () => {
    expect(isEmailAllowed("stranger@example.com", "owner@example.com")).toBe(false);
  });

  it("denies everybody when the list is empty", () => {
    expect(isEmailAllowed("owner@example.com", "")).toBe(false);
  });

  it("denies everybody when the list is unset", () => {
    expect(isEmailAllowed("owner@example.com", undefined)).toBe(false);
  });

  it("denies everybody when the list is only whitespace/commas", () => {
    expect(isEmailAllowed("owner@example.com", " , , ")).toBe(false);
  });
});
