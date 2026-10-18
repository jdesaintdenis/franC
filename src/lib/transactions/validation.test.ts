import { describe, expect, it } from "vitest";

import { canValidate, hasDestination } from "./validation";

const bare = { category: null, split: null, transfer: null, ignored: false, reviewed: false };

describe("validation", () => {
  it("needs a category", () => {
    expect(canValidate({ ...bare, category: {} })).toBe(true);
    expect(canValidate(bare)).toBe(false);
  });
  it("accepts a split, a confirmed transfer or an ignored row", () => {
    expect(hasDestination({ ...bare, split: {} })).toBe(true);
    expect(hasDestination({ ...bare, transfer: { status: "confirmed" } })).toBe(true);
    expect(hasDestination({ ...bare, ignored: true })).toBe(true);
  });
  it("refuses a detected transfer on its own", () => {
    expect(hasDestination({ ...bare, transfer: { status: "detected" } })).toBe(false);
  });
  it("is false for rows already reviewed", () => {
    expect(canValidate({ ...bare, category: {}, reviewed: true })).toBe(false);
  });
});
