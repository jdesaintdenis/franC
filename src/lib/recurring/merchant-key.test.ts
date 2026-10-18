import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeLabel } from "../import/normalize-label";
import { merchantKey } from "./merchant-key";

describe("merchantKey", () => {
  it.each([
    ["CB BOULANGERIE DES L FACT 250925", "BOULANGERIE DES L"],
    ["CB NETFLIX.COM FACT 050925", "NETFLIX.COM"],
    ["PRLV ORANGE BOX", "ORANGE BOX"],
    ["VIR SEPA ATELIER LUMEN SAS", "ATELIER LUMEN SAS"],
    ["VIR. VERS MME OU MR DURAND", "VERS MME OU MR DURAND"],
    ["VIR BERNARD LUCIE", "BERNARD LUCIE"],
    ["RETRAIT DAB 29-09-10001-200001", "RETRAIT DAB"],
    ["ECH PRET 100001A DU 06/09/25", "ECH PRET 100001A"],
    ["CB BOUTIQUE JEUX42 FACT 070925", "BOUTIQUE JEUX42"],
    ["COTISATION CARTE", "COTISATION CARTE"],
  ])("%s -> %s", (input, expected) => {
    expect(merchantKey(input)).toBe(expected);
  });

  it("gives the same key to every occurrence of a merchant", () => {
    expect(merchantKey("CB BOULANGERIE DES L FACT 110925")).toBe(
      merchantKey("CB BOULANGERIE DES L FACT 240925"),
    );
  });

  it("never returns an empty string", () => {
    expect(merchantKey("CB ")).toBe("CB");
    expect(merchantKey("123456")).toBe("123456");
    expect(merchantKey("")).toBe("");
  });

  it("stays a substring of the label for every sample label", () => {
    const csv = readFileSync(
      join(process.cwd(), "docs/samples/sample-export.csv"),
      "utf8",
    );
    const labels = csv
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.split(";")[2])
      .filter((label): label is string => Boolean(label))
      .map(normalizeLabel);
    expect(labels.length).toBeGreaterThan(50);
    for (const label of labels) {
      const key = merchantKey(label);
      expect(key).not.toBe("");
      expect(label).toContain(key);
    }
  });
});
