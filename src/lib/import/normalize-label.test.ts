// @vitest-environment node
import { describe, expect, it } from "vitest";

import { normalizeLabel } from "./normalize-label";

describe("normalizeLabel", () => {
  it("strips accents and uppercases", () => {
    expect(normalizeLabel("Café Crème à l'Été")).toBe("CAFE CREME A L'ETE");
  });

  it("collapses and trims whitespace", () => {
    expect(normalizeLabel("  CB   SNACK \t DU PORT  ")).toBe("CB SNACK DU PORT");
  });

  it("keeps punctuation and the FACT suffix", () => {
    expect(normalizeLabel("CB GITHUB, INC. FACT 140725")).toBe("CB GITHUB, INC. FACT 140725");
  });

  it("is idempotent", () => {
    for (const s of ["  Éàü  x ", "CB SNACK FACT 250925", "ﬁn"]) {
      expect(normalizeLabel(normalizeLabel(s))).toBe(normalizeLabel(s));
    }
  });
});
