import { describe, expect, it } from "vitest";

import { bankAmountToCents } from "./amount";

describe("bankAmountToCents", () => {
  it.each([
    ["12.30", "DBIT", -1230],
    ["12.3", "DBIT", -1230],
    ["12", "CRDT", 1200],
    ["2896.40", "CRDT", 289640],
    ["0.07", "DBIT", -7],
    ["0.00", "DBIT", 0],
    [" 5.88 ", "DBIT", -588],
    ["-5.88", null, -588],
    ["+5.88", undefined, 588],
  ] as const)("%s %s → %i", (amount, indicator, cents) => {
    expect(bankAmountToCents(amount, indicator)).toBe(cents);
  });

  it.each([
    ["12,30", "DBIT"],
    ["12.345", "DBIT"],
    ["1e3", "CRDT"],
    ["", "CRDT"],
    ["5.88", null],
    ["5.88", "OTHER"],
    ["99999999999999999999", "CRDT"],
  ] as const)("rejects %s %s", (amount, indicator) => {
    expect(bankAmountToCents(amount, indicator)).toBeNull();
  });
});
