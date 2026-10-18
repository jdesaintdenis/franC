import { describe, expect, it } from "vitest";

import { toDisplayCase } from "./display-case";

describe("toDisplayCase", () => {
  it("capitalises each word of an all-caps label", () => {
    expect(toDisplayCase("CARREFOUR CITY PARIS 15", "fr")).toBe("Carrefour City Paris 15");
  });

  it("leaves mixed case, lower case and letterless labels untouched", () => {
    expect(toDisplayCase("Carrefour CITY", "fr")).toBe("Carrefour CITY");
    expect(toDisplayCase("amazon", "en")).toBe("amazon");
    expect(toDisplayCase("1234 / 56", "en")).toBe("1234 / 56");
    expect(toDisplayCase("", "en")).toBe("");
  });

  it("lower-cases joining words except in first position", () => {
    expect(toDisplayCase("BOULANGERIE DU COIN ET FILS", "fr")).toBe("Boulangerie du Coin et Fils");
    expect(toDisplayCase("LA POSTE", "fr")).toBe("La Poste");
    expect(toDisplayCase("BANK OF THE WEST", "en")).toBe("Bank of the West");
  });

  it("keeps words with digits, dots and symbols", () => {
    expect(toDisplayCase("WWW.SNCF.COM", "fr")).toBe("WWW.SNCF.COM");
    expect(toDisplayCase("CB*1234 CARREFOUR", "fr")).toBe("CB*1234 Carrefour");
    expect(toDisplayCase("PAIEMENT 12/09 DUPONT", "fr")).toBe("Paiement 12/09 Dupont");
  });

  it("handles accents, hyphens and apostrophes", () => {
    expect(toDisplayCase("ÉPICERIE", "fr")).toBe("Épicerie");
    expect(toDisplayCase("SAINT-DENIS", "fr")).toBe("Saint-Denis");
    expect(toDisplayCase("L'ATELIER", "fr")).toBe("L'Atelier");
    expect(toDisplayCase("PHARMACIE D'ORLEANS", "fr")).toBe("Pharmacie d'Orleans");
  });

  it("cannot detect acronyms", () => {
    expect(toDisplayCase("PRLV SEPA EDF", "fr")).toBe("Prlv Sepa Edf");
  });

  it("preserves spacing", () => {
    expect(toDisplayCase("AB  CD", "en")).toBe("Ab  Cd");
  });

  it("lower-cases French joining words like ou and par", () => {
    expect(toDisplayCase("VIR VERS MME OU MR DURAND", "fr")).toBe("Vir Vers Mme ou Mr Durand");
    expect(toDisplayCase("PAIEMENT PAR CARTE", "en")).toBe("Paiement par Carte");
  });
});
