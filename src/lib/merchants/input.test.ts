import { describe, expect, it } from "vitest";

import {
  MERCHANT_INPUT_ERRORS,
  createMerchantSchema,
  merchantMatchTypeSchema,
  merchantNameSchema,
  merchantPatternSchema,
} from "./input";

const codes = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((i) => i.message) ?? [];

describe("merchantNameSchema", () => {
  it("trims and accepts 1 to 60 characters", () => {
    expect(merchantNameSchema.parse("  Orange  ")).toBe("Orange");
    expect(merchantNameSchema.safeParse("a".repeat(60)).success).toBe(true);
  });

  it("rejects empty and too long names with codes", () => {
    expect(codes(merchantNameSchema.safeParse("   "))).toEqual([MERCHANT_INPUT_ERRORS.nameRequired]);
    expect(codes(merchantNameSchema.safeParse("a".repeat(61)))).toEqual([MERCHANT_INPUT_ERRORS.nameTooLong]);
  });
});

describe("merchantPatternSchema", () => {
  it("trims and accepts up to 200 characters", () => {
    expect(merchantPatternSchema.parse("  ORANGE  ")).toBe("ORANGE");
    expect(merchantPatternSchema.safeParse("a".repeat(200)).success).toBe(true);
  });

  it("rejects empty, only-marks and too long patterns", () => {
    expect(merchantPatternSchema.safeParse("").success).toBe(false);
    expect(codes(merchantPatternSchema.safeParse("  "))).toContain(MERCHANT_INPUT_ERRORS.patternRequired);
    expect(codes(merchantPatternSchema.safeParse("́"))).toEqual([MERCHANT_INPUT_ERRORS.patternRequired]);
    expect(codes(merchantPatternSchema.safeParse("a".repeat(201)))).toEqual([MERCHANT_INPUT_ERRORS.patternTooLong]);
  });
});

describe("match type and create schema", () => {
  it("accepts the three types only", () => {
    for (const t of ["contains", "starts_with", "equals"]) expect(merchantMatchTypeSchema.safeParse(t).success).toBe(true);
    expect(merchantMatchTypeSchema.safeParse("regex").success).toBe(false);
  });

  it("parses a full create input", () => {
    expect(createMerchantSchema.parse({ name: " Orange ", matchType: "equals", pattern: " ORANGE " })).toEqual({
      name: "Orange",
      matchType: "equals",
      pattern: "ORANGE",
    });
  });
});
