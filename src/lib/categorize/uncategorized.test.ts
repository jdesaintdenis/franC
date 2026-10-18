import { describe, expect, it } from "vitest";

import { labelUncategorized } from "./uncategorized";

describe("labelUncategorized", () => {
  it("names only the rows without a category", () => {
    const rows = [
      { categoryId: "a", name: "Food", spentCents: 1 },
      { categoryId: null, name: null, spentCents: 2 },
    ];
    expect(labelUncategorized(rows, "Non catégorisé")).toEqual([
      { categoryId: "a", name: "Food", spentCents: 1 },
      { categoryId: null, name: "Non catégorisé", spentCents: 2 },
    ]);
  });
});
