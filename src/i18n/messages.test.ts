// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { locales } from "./config";
import { NAMESPACES } from "./messages";

type Flat = Map<string, unknown>;

function flatten(value: unknown, prefix: string, out: Flat): Flat {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  } else {
    out.set(prefix, value);
  }
  return out;
}

function load(locale: string, namespace: string): Flat {
  const file = path.join(process.cwd(), "messages", locale, `${namespace}.json`);
  return flatten(JSON.parse(readFileSync(file, "utf8")), "", new Map());
}

/** ICU argument names, e.g. "{count, plural, ...}" -> count. "#" and nested branch text are ignored. */
function argNames(message: string): string[] {
  const names = new Set<string>();
  for (const match of message.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/g)) names.add(match[1]);
  return [...names].sort();
}

/** Rich-text tag names, e.g. "<link>…</link>" -> link. */
function tagNames(message: string): string[] {
  return [...new Set([...message.matchAll(/<([A-Za-z][A-Za-z0-9]*)>/g)].map((m) => m[1]))].sort();
}

describe.each(NAMESPACES)("messages: %s", (namespace) => {
  const en = load("en", namespace);
  const fr = load("fr", namespace);

  it("has the same keys in en and fr", () => {
    const missingInFr = [...en.keys()].filter((k) => !fr.has(k));
    const missingInEn = [...fr.keys()].filter((k) => !en.has(k));
    expect(missingInFr, `keys in en/${namespace}.json missing from fr: ${missingInFr.join(", ")}`).toEqual([]);
    expect(missingInEn, `keys in fr/${namespace}.json missing from en: ${missingInEn.join(", ")}`).toEqual([]);
  });

  it("has only non-empty string values", () => {
    for (const [locale, flat] of [["en", en], ["fr", fr]] as const) {
      for (const [key, value] of flat) {
        expect(
          typeof value === "string" && value.trim() !== "",
          `${locale}/${namespace}.json: "${key}" must be a non-empty string`,
        ).toBe(true);
      }
    }
  });

  it("uses the same ICU arguments in en and fr", () => {
    for (const [key, enValue] of en) {
      const frValue = fr.get(key);
      if (typeof enValue !== "string" || typeof frValue !== "string") continue;
      expect(argNames(frValue), `ICU arguments differ for "${namespace}.${key}"`).toEqual(argNames(enValue));
      expect(tagNames(frValue), `rich-text tags differ for "${namespace}.${key}"`).toEqual(tagNames(enValue));
    }
  });

  // t.rich takes tags and arguments in one object, so "<amount>{amount}</amount>"
  // renders the tag function as text.
  it("never names an ICU argument like a rich-text tag", () => {
    for (const [locale, flat] of [["en", en], ["fr", fr]] as const) {
      for (const [key, value] of flat) {
        if (typeof value !== "string") continue;
        const tags = new Set(tagNames(value));
        const clashes = argNames(value).filter((name) => tags.has(name));
        expect(clashes, `${locale}/${namespace}.json: "${key}" uses ${clashes.join(", ")} as both tag and argument`).toEqual([]);
      }
    }
  });
});

describe("locales", () => {
  it("has a message directory for every locale", () => {
    expect(locales.length).toBeGreaterThan(0);
    for (const locale of locales) expect(() => load(locale, "common")).not.toThrow();
  });
});
