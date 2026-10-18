import { describe, expect, it } from "vitest";

import { MAX_NOTE_LENGTH, MAX_TAG_LENGTH, normalizeNote, normalizeTagName, parseTagList } from "./validate";

describe("normalizeTagName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeTagName("  Holidays \t 2026 ")).toEqual({ ok: true, name: "Holidays 2026" });
  });
  it("normalizes to NFC", () => {
    const result = normalizeTagName("Café");
    expect(result).toEqual({ ok: true, name: "Café" });
  });
  it("refuses empty and blank input", () => {
    expect(normalizeTagName("")).toEqual({ ok: false, code: "empty" });
    expect(normalizeTagName("  \n ")).toEqual({ ok: false, code: "empty" });
  });
  it("refuses a comma", () => {
    expect(normalizeTagName("a,b")).toEqual({ ok: false, code: "comma" });
  });
  it("accepts 40 characters and refuses 41, counted after normalization", () => {
    expect(normalizeTagName("a".repeat(MAX_TAG_LENGTH)).ok).toBe(true);
    expect(normalizeTagName("a".repeat(MAX_TAG_LENGTH + 1))).toEqual({ ok: false, code: "tooLong" });
    expect(normalizeTagName(`  ${"a".repeat(MAX_TAG_LENGTH)}   `).ok).toBe(true);
  });
});

describe("parseTagList", () => {
  it("splits on commas, skips empties and dedupes case-insensitively", () => {
    expect(parseTagList("Trip, , trip,Food  court,,TRIP").names).toEqual(["Trip", "Food court"]);
  });
  it("reports invalid entries but keeps the valid ones", () => {
    const result = parseTagList(`ok,${"x".repeat(41)}`);
    expect(result.names).toEqual(["ok"]);
    expect(result.errors).toEqual(["tooLong"]);
  });
  it("returns nothing for blank input", () => {
    expect(parseTagList(" , ")).toEqual({ names: [], errors: [] });
  });
});

describe("normalizeNote", () => {
  it("trims and keeps line breaks", () => {
    expect(normalizeNote("  line 1\nline 2  ")).toEqual({ ok: true, note: "line 1\nline 2" });
  });
  it("turns empty into null", () => {
    expect(normalizeNote("  \n ")).toEqual({ ok: true, note: null });
  });
  it("caps at 500 characters", () => {
    expect(normalizeNote("a".repeat(MAX_NOTE_LENGTH)).ok).toBe(true);
    expect(normalizeNote("a".repeat(MAX_NOTE_LENGTH + 1))).toEqual({ ok: false, code: "tooLong" });
  });
});
