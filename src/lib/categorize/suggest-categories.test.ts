import { describe, expect, it } from "vitest";

import type { GuessExample } from "./guess";
import { suggestCategories } from "./suggest-categories";

const example = (categoryId: string, over: Partial<GuessExample> = {}): GuessExample => ({
  categoryId,
  merchantId: null,
  labelNormalized: "OTHER",
  amountCents: -1000,
  date: "2025-01-01",
  ...over,
});
const target = { merchantId: "m1", labelNormalized: "CB CAFE DU COIN FACT 120926", date: "2026-10-07" };

describe("suggestCategories", () => {
  it("is empty without examples", () => {
    expect(suggestCategories([], target)).toEqual([]);
  });

  it("ranks the same merchant, then the same label key, then recent frequency", () => {
    const examples = [
      example("recent", { date: "2026-10-01" }),
      example("recent", { date: "2026-09-20" }),
      example("label", { labelNormalized: "CB CAFE DU COIN FACT 010126" }),
      example("merchant", { merchantId: "m1" }),
    ];
    expect(suggestCategories(examples, target)).toEqual(["merchant", "label", "recent"]);
  });

  it("caps the list", () => {
    const examples = ["a", "b", "c", "d", "e"].map((id) => example(id, { merchantId: "m1" }));
    expect(suggestCategories(examples, target)).toHaveLength(4);
  });

  it("falls back to the most used categories when the row has no history", () => {
    const examples = [example("rare"), example("often"), example("often"), example("often")];
    expect(suggestCategories(examples, target)).toEqual(["often", "rare"]);
  });
});
