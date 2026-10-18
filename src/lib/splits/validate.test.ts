import { describe, expect, it } from "vitest";

import { euroInputToSignedCents, splitRemainder, validateSplit } from "./validate";

const A = "cat-a";
const B = "cat-b";

describe("validateSplit", () => {
  it("accepts parts that sum exactly (outflow)", () => {
    expect(validateSplit(-4450, [{ categoryId: A, amountCents: -3210 }, { categoryId: B, amountCents: -1240 }])).toEqual({ ok: true });
  });

  it("accepts parts that sum exactly (inflow)", () => {
    expect(validateSplit(10000, [{ categoryId: A, amountCents: 6000 }, { categoryId: B, amountCents: 4000 }])).toEqual({ ok: true });
  });

  it("refuses a sum off by one cent, either way", () => {
    expect(validateSplit(-4450, [{ categoryId: A, amountCents: -3210 }, { categoryId: B, amountCents: -1239 }])).toEqual({ ok: false, error: "sum_mismatch" });
    expect(validateSplit(-4450, [{ categoryId: A, amountCents: -3210 }, { categoryId: B, amountCents: -1241 }])).toEqual({ ok: false, error: "sum_mismatch" });
  });

  it("refuses one part and 21 parts, accepts 2 and 20", () => {
    expect(validateSplit(-100, [{ categoryId: A, amountCents: -100 }])).toEqual({ ok: false, error: "too_few_parts" });
    expect(validateSplit(-100, [])).toEqual({ ok: false, error: "too_few_parts" });
    const many = (n: number) => Array.from({ length: n }, () => ({ categoryId: A, amountCents: -1 }));
    expect(validateSplit(-21, many(21))).toEqual({ ok: false, error: "too_many_parts" });
    expect(validateSplit(-20, many(20))).toEqual({ ok: true });
    expect(validateSplit(-2, many(2))).toEqual({ ok: true });
  });

  it("refuses zero and wrong-sign parts", () => {
    expect(validateSplit(-100, [{ categoryId: A, amountCents: 0 }, { categoryId: B, amountCents: -100 }])).toEqual({ ok: false, error: "invalid_amount" });
    expect(validateSplit(-100, [{ categoryId: A, amountCents: 50 }, { categoryId: B, amountCents: -150 }])).toEqual({ ok: false, error: "invalid_amount" });
    expect(validateSplit(100, [{ categoryId: A, amountCents: -50 }, { categoryId: B, amountCents: 150 }])).toEqual({ ok: false, error: "invalid_amount" });
  });

  it("refuses non-integer amounts", () => {
    expect(validateSplit(-100, [{ categoryId: A, amountCents: -50.5 }, { categoryId: B, amountCents: -49.5 }])).toEqual({ ok: false, error: "invalid_amount" });
  });

  it("refuses a part without a category", () => {
    expect(validateSplit(-100, [{ categoryId: null, amountCents: -50 }, { categoryId: B, amountCents: -50 }])).toEqual({ ok: false, error: "missing_category" });
  });

  it("allows two parts in the same category", () => {
    expect(validateSplit(-100, [{ categoryId: A, amountCents: -50 }, { categoryId: A, amountCents: -50 }])).toEqual({ ok: true });
  });
});

describe("splitRemainder", () => {
  it("is what is left to assign, or a negative excess", () => {
    expect(splitRemainder(-4450, [{ amountCents: -3210 }])).toBe(-1240);
    expect(splitRemainder(-4450, [{ amountCents: -3210 }, { amountCents: -1240 }])).toBe(0);
    expect(splitRemainder(-4450, [{ amountCents: -3210 }, { amountCents: -1540 }])).toBe(300);
    expect(splitRemainder(4450, [{ amountCents: 4750 }])).toBe(-300);
  });
});

describe("euroInputToSignedCents", () => {
  it("parses euro text and takes the sign from the transaction", () => {
    expect(euroInputToSignedCents("12", -5000)).toBe(-1200);
    expect(euroInputToSignedCents("12,50", -5000)).toBe(-1250);
    expect(euroInputToSignedCents("12.5", -5000)).toBe(-1250);
    expect(euroInputToSignedCents("12,50", 5000)).toBe(1250);
    expect(euroInputToSignedCents(" 0,05 ", 5000)).toBe(5);
  });

  it("returns null for text that is not an amount", () => {
    expect(euroInputToSignedCents("", -100)).toBeNull();
    expect(euroInputToSignedCents("abc", -100)).toBeNull();
    expect(euroInputToSignedCents("-5", -100)).toBeNull();
    expect(euroInputToSignedCents("1,234", -100)).toBeNull();
  });

  it("gives zero for a typed zero, which validation then refuses", () => {
    expect(euroInputToSignedCents("0", -100)).toBe(0);
  });
});
