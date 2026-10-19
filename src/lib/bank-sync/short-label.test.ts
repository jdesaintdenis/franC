import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { decodeUpload } from "../import/decode";
import { prepareImportGuessed } from "../import/prepare-guessed";
import { normalizeLabel } from "../import/normalize-label";
import { learnShortLabels, shortLabelFor, stripBankLabel } from "./short-label";

const sample = (() => {
  const bytes = readFileSync(path.join(process.cwd(), "docs/samples/sample-export.csv"));
  const parsed = prepareImportGuessed(decodeUpload(bytes), "acc-1");
  if (!parsed.ok) throw new Error("sample did not parse");
  return parsed.transactions;
})();

describe("stripBankLabel", () => {
  it.each([
    ["CB BOULANGERIE DES L FACT 250925", "BOULANGERIE DES L"],
    ["CB Boutique Jeux42 FACT 070925", "Boutique Jeux42"],
    ["PRLV ORANGE BOX", "ORANGE BOX"],
    ["PRLV SEPA EDF CLIENTS", "EDF CLIENTS"],
    ["VIR SEPA CAISSE AIDE FAMILLE", "CAISSE AIDE FAMILLE"],
    ["VIR INST BERNARD LUCIE", "BERNARD LUCIE"],
    ["VIR. VERS LIVRET EPARGNE", "VIR. VERS LIVRET EPARGNE"],
    ["ECH PRET 100001A DU 06/09/25", "ECHEANCE DE CREDIT"],
    ["RETRAIT DAB 29-09-10001-200001", "RETRAIT D'ESPECES"],
    ["  CB   KFC   FACT 010925 ", "KFC"],
    ["CB", "CB"],
    ["FACTURE 12/09", "FACTURE"],
  ])("%s → %s", (raw, expected) => {
    expect(stripBankLabel(raw)).toBe(expected);
  });

  it("removes every payment prefix and invoice date from the sample", () => {
    for (const row of sample) {
      const out = stripBankLabel(row.labelRaw);
      expect(out).not.toMatch(/^(CB|PRLV|VIR|ECH PRET|RETRAIT DAB)\s/);
      expect(out).not.toMatch(/FACT \d{6}$|\d{2}\/\d{2}\/\d{2}$/);
    }
  });

  it("alone matches most of the sample's short labels", () => {
    const equal = sample.filter((r) => normalizeLabel(stripBankLabel(r.labelRaw)) === normalizeLabel(r.labelSimplified));
    // Recorded so a change to the rules shows up here.
    expect([equal.length, sample.length]).toEqual([91, 140]);
  });
});

describe("learned short labels", () => {
  it("finishes truncated names and keeps the bank's renames", () => {
    const learned = learnShortLabels(sample);
    expect(shortLabelFor("CB BOULANGERIE DES L FACT 021025", learned)).toBe("BOULANGERIE DES LILAS");
    expect(shortLabelFor("CB AUTOROUTE A99 NORD FACT 011025", learned)).toBe("PEAGE AUTOROUTE");
    expect(shortLabelFor("PRLV TRESOR PUBLIC PRELEVEMENT", learned)).toBe("IMPOTS");
    expect(shortLabelFor("CB NOUVEAU COMMERCE FACT 011025", learned)).toBe("NOUVEAU COMMERCE");
  });

  it("matches every sample row once learned from the sample", () => {
    const learned = learnShortLabels(sample);
    for (const row of sample) expect(shortLabelFor(row.labelRaw, learned)).toBe(row.labelSimplified);
  });

  it("prefers the most frequent short label, then the newest", () => {
    const learned = learnShortLabels([
      { labelRaw: "CB SHOP FACT 010925", labelSimplified: "SHOP A", date: "2025-09-01" },
      { labelRaw: "CB SHOP FACT 020925", labelSimplified: "SHOP A", date: "2025-09-02" },
      { labelRaw: "CB SHOP FACT 030925", labelSimplified: "SHOP B", date: "2025-09-03" },
      { labelRaw: "CB CAFE FACT 010925", labelSimplified: "CAFE OLD", date: "2025-09-01" },
      { labelRaw: "CB CAFE FACT 050925", labelSimplified: "CAFE NEW", date: "2025-09-05" },
      { labelRaw: "CB EMPTY FACT 050925", labelSimplified: " ", date: "2025-09-05" },
    ]);
    expect(shortLabelFor("CB SHOP FACT 091025", learned)).toBe("SHOP A");
    expect(shortLabelFor("CB CAFE FACT 091025", learned)).toBe("CAFE NEW");
    expect(shortLabelFor("cb empty fact 091025", learned)).toBe("empty");
  });
});
