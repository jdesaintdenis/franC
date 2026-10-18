import { describe, expect, it } from "vitest";

import {
  CATEGORY_PALETTE,
  categoryDisplayColor,
  categoryTint,
  contrastRatio,
  LEGACY_BANK_CATEGORY_COLORS,
  nextCategoryColor,
  parseHexColor,
  subcategoryShade,
  UNCATEGORIZED_COLOR,
} from "./category-color";

describe("categoryDisplayColor", () => {
  it("keeps the colour in light mode and lifts its lightness in dark mode", () => {
    expect(categoryDisplayColor("#5D4037")).toBe("light-dark(#5D4037, oklch(from #5D4037 max(l, 0.72) c h))");
  });

  it("falls back to the uncategorized grey for missing or non-hex values", () => {
    const grey = categoryDisplayColor(UNCATEGORIZED_COLOR);
    expect(categoryDisplayColor(null)).toBe(grey);
    expect(categoryDisplayColor(undefined)).toBe(grey);
    expect(categoryDisplayColor("red")).toBe(grey);
    expect(categoryDisplayColor("#fff")).toBe(grey);
    expect(categoryDisplayColor("#123456; background: url(x)")).toBe(grey);
  });
});

describe("CATEGORY_PALETTE", () => {
  it("has distinct colours, none of them a legacy default", () => {
    expect(new Set(CATEGORY_PALETTE).size).toBe(CATEGORY_PALETTE.length);
    for (const c of CATEGORY_PALETTE) expect(LEGACY_BANK_CATEGORY_COLORS).not.toContain(c);
  });

  it("stays readable as a dot on a white card (3:1)", () => {
    for (const c of CATEGORY_PALETTE) expect(contrastRatio(c, "#ffffff")).toBeGreaterThanOrEqual(3);
  });

  it("avoids the brand blue and the money red and green", () => {
    for (const c of CATEGORY_PALETTE) {
      expect(["#0055a4", "#047857", "#c0262d", "#d62839"]).not.toContain(c);
    }
  });
});

describe("nextCategoryColor", () => {
  it("returns the first unused colour, ignoring case", () => {
    expect(nextCategoryColor([])).toBe(CATEGORY_PALETTE[0]);
    expect(nextCategoryColor([CATEGORY_PALETTE[0].toUpperCase(), "#123456"])).toBe(CATEGORY_PALETTE[1]);
  });

  it("cycles once every colour is used", () => {
    expect(nextCategoryColor([...CATEGORY_PALETTE])).toBe(CATEGORY_PALETTE[0]);
    expect(nextCategoryColor([...CATEGORY_PALETTE, "#000000"])).toBe(CATEGORY_PALETTE[1]);
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG extremes", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });
});

describe("subcategoryShade", () => {
  it("gives siblings distinct colours that differ from the parent", () => {
    for (const parent of CATEGORY_PALETTE) {
      const shades = [0, 1, 2, 3, 4, 5].map((i) => subcategoryShade(parent, i));
      expect(new Set([parent, ...shades]).size).toBe(7);
    }
  });

  it("keeps every shade at 3:1 on white", () => {
    for (const parent of CATEGORY_PALETTE) {
      for (let i = 0; i < 6; i++) {
        expect(contrastRatio(subcategoryShade(parent, i), "#ffffff")).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("is lowercase hex, ignores the parent's case and repeats after six", () => {
    expect(subcategoryShade("#7C3AED", 1)).toMatch(/^#[0-9a-f]{6}$/);
    expect(subcategoryShade("#7C3AED", 1)).toBe(subcategoryShade("#7c3aed", 1));
    expect(subcategoryShade("#7c3aed", 6)).toBe(subcategoryShade("#7c3aed", 0));
  });
});

describe("parseHexColor", () => {
  it("normalizes to lowercase with a leading #", () => {
    expect(parseHexColor("#1e3a8a")).toBe("#1e3a8a");
    expect(parseHexColor("1E3A8A")).toBe("#1e3a8a");
    expect(parseHexColor("  #AbCdEf ")).toBe("#abcdef");
  });
  it("rejects anything that is not a 6-digit hex colour", () => {
    for (const bad of ["", "#abc", "abc", "#1e3a8g", "##1e3a8a", "#1e3a8a0", "red"]) {
      expect(parseHexColor(bad)).toBeNull();
    }
  });
});

describe("categoryTint", () => {
  it("mixes the display colour over transparent", () => {
    expect(categoryTint("#7c3aed")).toContain("color-mix(in srgb, light-dark(#7c3aed");
    expect(categoryTint("#7c3aed")).toContain("15%");
    expect(categoryTint("#7c3aed", 25)).toContain("25%");
  });
});
