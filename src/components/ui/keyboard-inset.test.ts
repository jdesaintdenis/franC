import { describe, expect, it } from "vitest";

import { keyboardInset } from "./keyboard-inset";

describe("keyboardInset", () => {
  it("is 0 without a keyboard", () => {
    expect(keyboardInset(844, { height: 844, offsetTop: 0 })).toBe(0);
  });
  it("is the covered height with a keyboard", () => {
    expect(keyboardInset(844, { height: 544, offsetTop: 0 })).toBe(300);
  });
  it("subtracts the offset iOS adds when it scrolls the page to the field", () => {
    expect(keyboardInset(844, { height: 544, offsetTop: 120 })).toBe(180);
  });
  it("is never negative", () => {
    expect(keyboardInset(844, { height: 900, offsetTop: 0 })).toBe(0);
  });
  it("rounds", () => {
    expect(keyboardInset(844, { height: 543.6, offsetTop: 0 })).toBe(300);
  });
});
