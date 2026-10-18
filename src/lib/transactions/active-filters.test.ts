import { describe, expect, it } from "vitest";

import { countActiveFilters } from "./active-filters";

const none = { from: "", to: "", category: "", account: "", tag: "", min: "", max: "", direction: "all", transfers: "", ignored: "", review: "" };

describe("countActiveFilters", () => {
  it("is zero with nothing set", () => {
    expect(countActiveFilters(none)).toBe(0);
  });

  it("counts a date range or an amount range once, and the review filter", () => {
    expect(countActiveFilters({ ...none, from: "2026-01-01", to: "2026-02-01", min: "1", max: "9", review: "todo", direction: "out" })).toBe(4);
  });
});
