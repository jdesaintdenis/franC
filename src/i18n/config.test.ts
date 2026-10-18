// @vitest-environment node
import { describe, expect, it } from "vitest";

import { asLocale, formattingLocale, resolveLocale } from "./config";

describe("resolveLocale", () => {
  it("prefers the saved preference over everything", () => {
    expect(resolveLocale({ saved: "fr", cookie: "en", acceptLanguage: "en-US" })).toBe("fr");
    expect(resolveLocale({ saved: "en", cookie: "fr", acceptLanguage: "fr-FR" })).toBe("en");
  });

  it("uses the cookie when nothing is saved", () => {
    expect(resolveLocale({ saved: null, cookie: "fr", acceptLanguage: "en-US" })).toBe("fr");
    expect(resolveLocale({ cookie: "en", acceptLanguage: "fr-FR" })).toBe("en");
  });

  it("ignores invalid saved and cookie values", () => {
    expect(resolveLocale({ saved: "de", cookie: "xx", acceptLanguage: "fr" })).toBe("fr");
    expect(resolveLocale({ saved: "", cookie: "", acceptLanguage: null })).toBe("en");
  });

  it("matches Accept-Language regions and q-values", () => {
    expect(resolveLocale({ acceptLanguage: "fr-FR,fr;q=0.9" })).toBe("fr");
    expect(resolveLocale({ acceptLanguage: "fr-CA" })).toBe("fr");
    expect(resolveLocale({ acceptLanguage: "en-US,en;q=0.9,fr;q=0.8" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "de;q=0.9, fr;q=0.8, en;q=0.5" })).toBe("fr");
    expect(resolveLocale({ acceptLanguage: "en;q=0.5, fr;q=0.9" })).toBe("fr");
  });

  it("is case-insensitive and tolerates spaces", () => {
    expect(resolveLocale({ acceptLanguage: " FR-fr , en;q=0.8" })).toBe("fr");
    expect(resolveLocale({ acceptLanguage: "fr ; q = 0.4, en;q=0.9" })).toBe("en");
  });

  it("skips q=0, wildcards and malformed entries", () => {
    expect(resolveLocale({ acceptLanguage: "fr;q=0, en" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "*" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "fr;q=abc" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: ",,;;" })).toBe("en");
  });

  it("falls back to English", () => {
    expect(resolveLocale({})).toBe("en");
    expect(resolveLocale({ acceptLanguage: "de-DE,es;q=0.8" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "" })).toBe("en");
  });

  it("keeps header order for equal q-values", () => {
    expect(resolveLocale({ acceptLanguage: "fr, en" })).toBe("fr");
    expect(resolveLocale({ acceptLanguage: "en, fr" })).toBe("en");
  });
});

describe("formattingLocale / asLocale", () => {
  it("maps locales to Intl tags", () => {
    expect(formattingLocale("fr")).toBe("fr-FR");
    expect(formattingLocale("en")).toBe("en-GB");
  });

  it("narrows unknown strings to English", () => {
    expect(asLocale("fr")).toBe("fr");
    expect(asLocale("de")).toBe("en");
  });
});
