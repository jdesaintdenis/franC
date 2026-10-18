import { describe, expect, it } from "vitest";

import { buildGuesser, GUESS_THRESHOLD, tokenize, type GuessExample, type GuessTarget } from "./guess";

const FOOD = "cat-food";
const RESTO = "cat-resto";
const SHOP = "cat-shop";

function ex(categoryId: string, label: string, over: Partial<GuessExample> = {}): GuessExample {
  return { categoryId, merchantId: null, labelNormalized: label, amountCents: -450, date: "2025-09-01", ...over };
}
function target(label: string, over: Partial<GuessTarget> = {}): GuessTarget {
  return { merchantId: null, labelNormalized: label, amountCents: -450, date: "2025-09-25", ...over };
}

const BAKERY = "CB BOULANGERIE DES L FACT 250925";

describe("buildGuesser", () => {
  it("returns null with no history", () => {
    expect(buildGuesser([])(target(BAKERY))).toBeNull();
  });

  it("guesses from one example of the same merchant key: 0.8 x 0.95", () => {
    const g = buildGuesser([ex(FOOD, "CB BOULANGERIE DES L FACT 250801")])(target(BAKERY));
    expect(g?.categoryId).toBe(FOOD);
    expect(g?.confidence).toBeCloseTo(0.76, 2);
  });

  it("guesses the majority with two against one: about 0.63", () => {
    const g = buildGuesser([
      ex(FOOD, "CB BOULANGERIE DES L FACT 250801"),
      ex(FOOD, "CB BOULANGERIE DES L FACT 250802"),
      ex(RESTO, "CB BOULANGERIE DES L FACT 250803"),
    ])(target(BAKERY));
    expect(g?.categoryId).toBe(FOOD);
    expect(g?.confidence).toBeCloseTo(0.63, 2);
  });

  it("does not guess at one each (0.5 < threshold)", () => {
    const g = buildGuesser([
      ex(FOOD, "CB BOULANGERIE DES L FACT 250801"),
      ex(RESTO, "CB BOULANGERIE DES L FACT 250802"),
    ])(target(BAKERY));
    expect(g).toBeNull();
    expect(GUESS_THRESHOLD).toBe(0.6);
  });

  it("the merchant id tier beats the key tier", () => {
    const guess = buildGuesser([
      ex(SHOP, "CB AUCHAN 1234 FACT 250801", { merchantId: "m1" }),
      ex(FOOD, "CB BOULANGERIE DES L FACT 250801"),
      ex(FOOD, "CB BOULANGERIE DES L FACT 250802"),
    ]);
    // The row's key matches the Food examples, but its merchant has a Shopping history.
    const g = guess(target(BAKERY, { merchantId: "m1" }));
    expect(g?.categoryId).toBe(SHOP);
    expect(g?.confidence).toBeCloseTo(0.8, 5);
  });

  it("falls back to the key tier when the merchant has no example", () => {
    const g = buildGuesser([ex(FOOD, "CB BOULANGERIE DES L FACT 250801")])(target(BAKERY, { merchantId: "m9" }));
    expect(g?.categoryId).toBe(FOOD);
  });

  it("the key tier beats similar labels", () => {
    const guess = buildGuesser([
      ex(FOOD, "CB BOULANGERIE DES L FACT 250801"),
      ex(SHOP, "CB BOULANGERIE DES LILAS FACT 250801"),
      ex(SHOP, "CB BOULANGERIE DES LILAS FACT 250802"),
    ]);
    expect(guess(target(BAKERY))?.categoryId).toBe(FOOD);
  });

  it("guesses from a similar label with the best similarity as tier weight", () => {
    const g = buildGuesser([
      ex(FOOD, "CB CARREFOUR MARKET PARIS FACT 250801"),
      ex(FOOD, "CB CARREFOUR MARKET PARIS FACT 250802"),
      ex(SHOP, "CB DECATHLON LILLE FACT 250803"),
    ])(target("CB CARREFOUR MARKET FACT 250925"));
    expect(g?.categoryId).toBe(FOOD);
    expect(g!.confidence).toBeGreaterThanOrEqual(GUESS_THRESHOLD);
    expect(g!.confidence).toBeLessThan(1);
  });

  it("does not guess from unrelated labels", () => {
    const g = buildGuesser([ex(FOOD, "CB CARREFOUR MARKET PARIS FACT 250801")])(target("CB DECATHLON LILLE FACT 250925"));
    expect(g).toBeNull();
  });

  it("never mixes signs: a refund does not learn from purchases", () => {
    const g = buildGuesser([ex(FOOD, "CB BOULANGERIE DES L FACT 250801", { amountCents: -450 })])(
      target(BAKERY, { amountCents: 450 }),
    );
    expect(g).toBeNull();
  });

  it("weights recent choices more (half-life 180 days)", () => {
    const guess = buildGuesser([
      ex(RESTO, "CB BOULANGERIE DES L FACT 240101", { date: "2024-01-01" }),
      ex(RESTO, "CB BOULANGERIE DES L FACT 240102", { date: "2024-01-02" }),
      ex(FOOD, "CB BOULANGERIE DES L FACT 250901", { date: "2025-09-01" }),
      ex(FOOD, "CB BOULANGERIE DES L FACT 250902", { date: "2025-09-02" }),
    ]);
    const g = guess(target(BAKERY));
    expect(g?.categoryId).toBe(FOOD);
    expect(g!.confidence).toBeGreaterThan(0.8);
  });

  it("ties break deterministically whatever the input order", () => {
    const a = ex("b-cat", "CB BOULANGERIE DES L FACT 250801");
    const b = ex("a-cat", "CB BOULANGERIE DES L FACT 250801");
    // Equal votes give 0.5 x 0.95: below threshold, so no guess, in either order.
    expect(buildGuesser([a, b])(target(BAKERY))).toBe(buildGuesser([b, a])(target(BAKERY)));
  });

  it("ignores one-letter and numeric tokens when comparing labels", () => {
    expect([...tokenize("BOULANGERIE DES L 1234 A")]).toEqual(["BOULANGERIE", "DES"]);
    // Only a number differs: similar label, same tokens.
    const g = buildGuesser([ex(FOOD, "CB PHARMACIE CENTRALE 12 FACT 250801")])(target("CB PHARMACIE CENTRALE 99 FACT 250925"));
    expect(g?.categoryId).toBe(FOOD);
  });

  it("computes day differences without time-zone drift", () => {
    const g1 = buildGuesser([ex(FOOD, "CB BOULANGERIE DES L FACT 250801", { date: "2025-03-29" })])(
      target(BAKERY, { date: "2025-03-30" }),
    );
    const g2 = buildGuesser([ex(FOOD, "CB BOULANGERIE DES L FACT 250801", { date: "2025-03-29" })])(
      target(BAKERY, { date: "2025-03-29" }),
    );
    expect(g1?.confidence).toBeCloseTo(g2!.confidence, 10);
  });
});
