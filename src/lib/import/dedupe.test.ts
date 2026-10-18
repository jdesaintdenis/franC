// @vitest-environment node
import { describe, expect, it } from "vitest";

import { assignDedupeKeys, computeDedupeHash, dedupeKey, partitionByExisting } from "./dedupe";
import type { ParsedTransaction } from "./types";

function tx(over: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return { line: 2, date: "2025-09-10", amountCents: -1591, labelRaw: "x", labelSimplified: "x", labelNormalized: "CB X", bankCategory: null, bankSubcategory: null, ...over };
}

describe("computeDedupeHash", () => {
  it("is deterministic and hex sha-256", () => {
    expect(computeDedupeHash("a", tx())).toBe(computeDedupeHash("a", tx()));
    expect(computeDedupeHash("a", tx())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs by account, date, amount and label", () => {
    const base = computeDedupeHash("a", tx());
    expect(computeDedupeHash("b", tx())).not.toBe(base);
    expect(computeDedupeHash("a", tx({ date: "2025-09-11" }))).not.toBe(base);
    expect(computeDedupeHash("a", tx({ amountCents: -1592 }))).not.toBe(base);
    expect(computeDedupeHash("a", tx({ labelNormalized: "CB Y" }))).not.toBe(base);
  });

  it("does not collide across field separators", () => {
    expect(computeDedupeHash("a|b", tx({ labelNormalized: "c" }))).not.toBe(
      computeDedupeHash("a", tx({ labelNormalized: "b|c" })),
    );
  });
});

describe("assignDedupeKeys / partitionByExisting", () => {
  it("indexes identical rows 0,1,2 and leaves distinct rows at 0", () => {
    const keyed = assignDedupeKeys([tx(), tx(), tx({ amountCents: -5 }), tx()], "a");
    expect(keyed.map((k) => k.occurrenceIndex)).toEqual([0, 1, 0, 2]);
  });

  it("splits fresh from duplicates", () => {
    const keyed = assignDedupeKeys([tx(), tx(), tx()], "a");
    const existing = new Set(keyed.slice(0, 2).map(dedupeKey));
    const { fresh, duplicates } = partitionByExisting(keyed, existing);
    expect(fresh.map((k) => k.occurrenceIndex)).toEqual([2]);
    expect(duplicates).toHaveLength(2);
  });
});
