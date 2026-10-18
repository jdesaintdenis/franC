import { describe, expect, it } from "vitest";

import { parseAccountName } from "./name";

describe("parseAccountName", () => {
  it("trims the name", () => {
    expect(parseAccountName("  Joint account ")).toEqual({ ok: true, name: "Joint account" });
  });

  it("accepts 1 and 50 characters", () => {
    expect(parseAccountName("a").ok).toBe(true);
    expect(parseAccountName("a".repeat(50)).ok).toBe(true);
  });

  it("rejects empty and whitespace-only names as required", () => {
    expect(parseAccountName("")).toEqual({ ok: false, error: "required" });
    expect(parseAccountName("   ")).toEqual({ ok: false, error: "required" });
  });

  it("rejects non-strings as required", () => {
    expect(parseAccountName(undefined)).toEqual({ ok: false, error: "required" });
    expect(parseAccountName(42)).toEqual({ ok: false, error: "required" });
  });

  it("rejects more than 50 characters after trimming", () => {
    expect(parseAccountName("a".repeat(51))).toEqual({ ok: false, error: "tooLong" });
    expect(parseAccountName(` ${"a".repeat(50)} `).ok).toBe(true);
  });
});
