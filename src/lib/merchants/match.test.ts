import { describe, expect, it } from "vitest";

import {
  compileMerchantPatterns,
  resolveMerchant,
  type MerchantMatchType,
  type MerchantPatternInput,
} from "./match";

const INTERMARCHE = { normalized: "CB INTERMARCHE FACT 110925", display: "INTERMARCHE" };
const INTERMAR_CENTRE = { normalized: "CB INTERMAR CENTRE FACT 110925", display: "INTERMAR CENTRE" };
const ORANGE = { normalized: "PRLV ORANGE BOX", display: "ORANGE" };
const ORANGE_TOLL = { normalized: "CB ASF ORANGERAIE FACT 110925", display: "ASF ORANGERAIE" };
const VETO = { normalized: "CB CLINIQUE ANIMALE FACT 250925", display: "Clinique Vétérinaire" };

function pattern(
  merchantId: string,
  matchType: MerchantMatchType,
  text: string,
  createdAt = "2025-01-01T00:00:00Z",
): MerchantPatternInput {
  return { merchantId, matchType, pattern: text, createdAt: new Date(createdAt) };
}

const resolve = (patterns: MerchantPatternInput[], labels: { normalized: string | null; display: string | null }) =>
  resolveMerchant(compileMerchantPatterns(patterns), labels);

describe("resolveMerchant: match types", () => {
  it("equals matches the simplified label but not the toll", () => {
    const p = [pattern("orange", "equals", "orange")];
    expect(resolve(p, ORANGE)).toBe("orange");
    expect(resolve(p, ORANGE_TOLL)).toBeNull();
  });

  it("starts_with matches the start of the raw label", () => {
    const p = [pattern("orange", "starts_with", "prlv orange")];
    expect(resolve(p, ORANGE)).toBe("orange");
    expect(resolve(p, ORANGE_TOLL)).toBeNull();
  });

  it("contains matches anywhere, so it also catches the toll", () => {
    const p = [pattern("orange", "contains", "orange")];
    expect(resolve(p, ORANGE)).toBe("orange");
    expect(resolve(p, ORANGE_TOLL)).toBe("orange");
  });

  it("ignores case and accents in the pattern and the labels", () => {
    expect(resolve([pattern("vet", "contains", "VETERINAIRE")], VETO)).toBe("vet");
    expect(resolve([pattern("vet", "equals", "clinique veterinaire")], VETO)).toBe("vet");
  });

  it("handles null labels and no match", () => {
    const p = [pattern("orange", "contains", "orange")];
    expect(resolve(p, { normalized: null, display: null })).toBeNull();
    expect(resolve(p, VETO)).toBeNull();
    expect(resolve([], ORANGE)).toBeNull();
  });

  it("names two label variants of one merchant with two patterns", () => {
    const p = [pattern("inter", "contains", "INTERMARCHE"), pattern("inter", "contains", "INTERMAR CENTRE")];
    expect(resolve(p, INTERMARCHE)).toBe("inter");
    expect(resolve(p, INTERMAR_CENTRE)).toBe("inter");
  });

  it("never matches an empty pattern, even one that normalizes to nothing", () => {
    for (const text of ["", "   ", "́"]) {
      expect(resolve([pattern("x", "contains", text)], ORANGE)).toBeNull();
      expect(resolve([pattern("x", "starts_with", text)], ORANGE)).toBeNull();
    }
  });
});

describe("resolveMerchant: precedence", () => {
  it("equals beats starts_with beats contains, whatever the length", () => {
    const labels = { normalized: "CB ORANGE", display: "ORANGE" };
    const contains = pattern("c", "contains", "ORANGE");
    const starts = pattern("s", "starts_with", "CB ORANGE");
    const equals = pattern("e", "equals", "ORANGE");
    expect(resolve([contains, starts, equals], labels)).toBe("e");
    expect(resolve([contains, starts], labels)).toBe("s");
    expect(resolve([starts, contains], labels)).toBe("s");
  });

  it("prefers the longer pattern within a type", () => {
    const short = pattern("short", "contains", "ORANGE");
    const long = pattern("long", "contains", "ORANGE BO");
    expect(resolve([short, long], ORANGE)).toBe("long");
  });

  it("then the oldest pattern, then the smaller merchant id", () => {
    const newer = pattern("a", "contains", "ORANGE", "2025-06-01T00:00:00Z");
    const older = pattern("b", "contains", "ORANGE", "2025-01-01T00:00:00Z");
    expect(resolve([newer, older], ORANGE)).toBe("b");
    const same1 = pattern("m2", "contains", "ORANGE");
    const same2 = pattern("m1", "contains", "ORANGE");
    expect(resolve([same1, same2], ORANGE)).toBe("m1");
  });

  it("does not depend on the input order", () => {
    const ps = [
      pattern("c", "contains", "ORANGE"),
      pattern("s", "starts_with", "PRLV"),
      pattern("l", "contains", "ORANGE BO"),
    ];
    expect(resolve(ps, ORANGE)).toBe("s");
    expect(resolve([...ps].reverse(), ORANGE)).toBe("s");
  });
});
