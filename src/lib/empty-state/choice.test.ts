import { describe, expect, it } from "vitest";

import { recurringEmptyAction, transactionsEmptyKind, yearEmptyAlternative } from "./choice";

describe("empty-state choices", () => {
  it("tells no transactions from no match", () => {
    expect(transactionsEmptyKind(false)).toBe("none");
    expect(transactionsEmptyKind(true)).toBe("noMatch");
  });
  it("offers detection only when there are transactions", () => {
    expect(recurringEmptyAction(0)).toBe("import");
    expect(recurringEmptyAction(12)).toBe("detect");
  });
  it("offers another year only when it differs", () => {
    expect(yearEmptyAlternative(2026, null)).toBeNull();
    expect(yearEmptyAlternative(2026, 2026)).toBeNull();
    expect(yearEmptyAlternative(2026, 2025)).toBe(2025);
  });
});
