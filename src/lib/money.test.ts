// @vitest-environment node
import { describe, expect, it } from "vitest";

import { centsToFrancs, formatFrancsNumber, formatCompactCents, formatCents, formatPercent, formatWholeCents, formatSignedCents, formatSignedWholeCents } from "./money";

const NNBSP = " ";
const NBSP = " ";

describe("formatCents", () => {
  it("formats French amounts with a narrow no-break thousands separator", () => {
    expect(formatCents(-6650, "fr")).toBe(`-66,50${NBSP}€`);
    expect(formatCents(123456, "fr")).toBe(`1${NNBSP}234,56${NBSP}€`);
    expect(formatCents(0, "fr")).toBe(`0,00${NBSP}€`);
  });

  it("formats English amounts with the symbol first", () => {
    expect(formatCents(123456, "en")).toBe("€1,234.56");
    expect(formatCents(-6650, "en")).toBe("-€66.50");
    expect(formatCents(0, "en")).toBe("€0.00");
  });

  it("keeps sub-euro amounts", () => {
    expect(formatCents(5, "fr")).toBe(`0,05${NBSP}€`);
    expect(formatCents(5, "en")).toBe("€0.05");
  });
});

describe("formatSignedWholeCents", () => {
  it("rounds to whole euros and signs inflows", () => {
    expect(formatSignedWholeCents(285_040, "en")).toBe("+€2,850");
    expect(formatSignedWholeCents(285_040, "fr")).toBe("+2\u202f850\u00a0€");
    expect(formatSignedWholeCents(-4_000, "en")).toBe("-€40");
  });
});

describe("formatSignedCents", () => {
  it("prefixes inflows with + and leaves outflows and zero as formatCents", () => {
    expect(formatSignedCents(1234, "fr")).toBe(`+12,34${NBSP}€`);
    expect(formatSignedCents(-1234, "fr")).toBe(`-12,34${NBSP}€`);
    expect(formatSignedCents(0, "fr")).toBe(`0,00${NBSP}€`);
    expect(formatSignedCents(1234, "en")).toBe("+€12.34");
    expect(formatSignedCents(-1234, "en")).toBe("-€12.34");
    expect(formatSignedCents(0, "en")).toBe("€0.00");
  });
});

describe("formatPercent", () => {
  it("formats a whole percent in the locale's style", () => {
    expect(formatPercent(32, "en")).toBe("32%");
    expect(formatPercent(100, "en")).toBe("100%");
    expect(formatPercent(32, "fr")).toMatch(/^32\s%$/u);
  });
});

describe("formatWholeCents", () => {
  it("drops the cents, rounding to the nearest euro", () => {
    expect(formatWholeCents(123456, "en")).toBe("€1,235");
    expect(formatWholeCents(-6650, "en")).toBe("-€67");
    expect(formatWholeCents(0, "en")).toBe("€0");
    expect(formatWholeCents(123456, "fr")).toBe(`1${NNBSP}235${NBSP}€`);
  });
});

describe("formatCompactCents", () => {
  it("abbreviates thousands in English", () => {
    expect(formatCompactCents(290000, "en")).toBe("€2.9k");
    expect(formatCompactCents(1500000, "en")).toBe("€15k");
    expect(formatCompactCents(-290000, "en")).toBe("-€2.9k");
    expect(formatCompactCents(250000000, "en")).toBe("€2.5m");
  });

  it("abbreviates thousands in French", () => {
    expect(formatCompactCents(290000, "fr")).toBe(`2,9${NBSP}k${NBSP}€`);
    expect(formatCompactCents(-290000, "fr")).toBe(`-2,9${NBSP}k${NBSP}€`);
  });

  it("shows whole euros under 1,000", () => {
    expect(formatCompactCents(0, "en")).toBe("€0");
    expect(formatCompactCents(99999, "en")).toBe("€1,000");
    expect(formatCompactCents(-4550, "en")).toBe("-€46");
    expect(formatCompactCents(0, "fr")).toBe(`0${NBSP}€`);
  });
});

describe("no negative zero", () => {
  it("never prints a minus sign for a value that rounds to zero", () => {
    expect(formatWholeCents(-40, "en")).toBe("€0");
    expect(formatWholeCents(-40, "fr")).toBe(`0${NBSP}€`);
    expect(formatPercent(-0.3, "en")).toBe("0%");
    expect(formatPercent(-0.3, "fr")).toMatch(/^0\s%$/u);
    expect(formatCompactCents(-40, "en")).toBe("€0");
    expect(formatCompactCents(-40, "fr")).toBe(`0${NBSP}€`);
  });

  it("keeps the sign on real negatives", () => {
    expect(formatPercent(-3, "en")).toBe("-3%");
    expect(formatWholeCents(-6650, "fr")).toBe(`-67${NBSP}€`);
  });
});

describe("francs", () => {
  it("converts at the legal rate, rounded half away from zero", () => {
    expect(centsToFrancs(151200)).toBe(9918);
    expect(centsToFrancs(100)).toBe(7);
    expect(centsToFrancs(-151200)).toBe(-9918);
    expect(centsToFrancs(0)).toBe(0);
    expect(centsToFrancs(10_000_000)).toBe(655957);
    // 0.76 € = 4.985 F → 5; 0.75 € = 4.92 F → 5; 0.07 € = 0.459 F → 0
    expect(centsToFrancs(76)).toBe(5);
    expect(centsToFrancs(7)).toBe(0);
  });

  it("groups digits per locale", () => {
    expect(formatFrancsNumber(151200, "fr")).toMatch(/^9\s918$/u);
    expect(formatFrancsNumber(151200, "en")).toBe("9,918");
    expect(formatFrancsNumber(-151200, "en")).toBe("-9,918");
  });
});
