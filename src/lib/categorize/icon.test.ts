import { describe, expect, it } from "vitest";

import { categoryIconSchema, withIcon } from "./icon";
import { categoryInput } from "./schemas";

describe("categoryIconSchema", () => {
  it.each(["🏠", "👍🏽", "🇫🇷", "👨‍👩‍👧", "🛋️"])("accepts %s", (emoji) => {
    expect(categoryIconSchema.parse(emoji)).toBe(emoji);
  });

  it("canonicalizes emojibase's variation-selector spelling (house is U+1F3E0 U+FE0F there)", () => {
    expect(categoryIconSchema.parse("\u{1F3E0}\uFE0F")).toBe("\u{1F3E0}");
    // Text-default emoji need their selector to be RGI, so it stays.
    expect(categoryIconSchema.parse("\u{1F6CB}\uFE0F")).toBe("\u{1F6CB}\uFE0F");
  });

  it("accepts every emoji the picker's data can produce", () => {
    // Emojibase ships the same data the picker fetches; skin-tone variants included.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const data: { emoji: string; group?: number; skins?: { emoji: string }[] }[] = require("emojibase-data/en/data.json");
    const rejected = data
      .filter((e) => e.group !== undefined)
      .flatMap((e) => [e.emoji, ...(e.skins ?? []).map((s) => s.emoji)])
      .filter((emoji) => !categoryIconSchema.safeParse(emoji).success);
    expect(rejected).toEqual([]);
  });

  it("trims surrounding whitespace", () => {
    expect(categoryIconSchema.parse("  🏠 ")).toBe("🏠");
  });

  it.each(["home", "🏠🏠", "🏠 x", "x🏠", "1", "#", "*", "🏠 🏠"])("rejects %j", (value) => {
    const result = categoryIconSchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual(["icon_invalid"]);
  });

  it("turns empty and whitespace-only input into null", () => {
    expect(categoryIconSchema.parse("")).toBeNull();
    expect(categoryIconSchema.parse("   ")).toBeNull();
  });

  it("rejects values over 32 characters", () => {
    expect(categoryIconSchema.safeParse("👨‍👩‍👧".repeat(10)).success).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(categoryIconSchema.safeParse(42).success).toBe(false);
  });
});

describe("categoryInput icon", () => {
  const base = { name: "Pets", color: "#aabbcc" };
  it("leaves icon undefined when absent (unchanged on update)", () => {
    expect(categoryInput.parse(base).icon).toBeUndefined();
  });
  it("parses an emoji and clears with an empty string", () => {
    expect(categoryInput.parse({ ...base, icon: "🐶" }).icon).toBe("🐶");
    expect(categoryInput.parse({ ...base, icon: "" }).icon).toBeNull();
  });
  it("reports icon_invalid", () => {
    const result = categoryInput.safeParse({ ...base, icon: "dog" });
    expect(result.error?.issues.map((i) => i.message)).toEqual(["icon_invalid"]);
  });
});

describe("withIcon", () => {
  it("prefixes the icon, or returns the name alone", () => {
    expect(withIcon("🏠", "Housing")).toBe("🏠 Housing");
    expect(withIcon(null, "Housing")).toBe("Housing");
  });
});
