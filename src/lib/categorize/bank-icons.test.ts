import { describe, expect, it } from "vitest";

import { bankCategoryIcon, bankCategoryIconEntries, normalizeBankCategoryName } from "./bank-icons";

describe("bankCategoryIcon", () => {
  it("knows the sample export's top-level categories", () => {
    expect(bankCategoryIcon("Alimentation")).toBe("🛒");
    expect(bankCategoryIcon("Logement - maison")).toBe("🏠");
    expect(bankCategoryIcon("Transports")).toBe("🚗");
    expect(bankCategoryIcon("Loisirs et vacances")).toBe("🎉");
    expect(bankCategoryIcon("Banque et assurances")).toBe("🏦");
    expect(bankCategoryIcon("Shopping et services")).toBe("🛍️");
    expect(bankCategoryIcon("Impots et taxes")).toBe("🧾");
  });

  it("ignores case, accents and extra spaces", () => {
    expect(bankCategoryIcon("Santé")).toBe("🩺");
    expect(bankCategoryIcon("  SANTE ")).toBe("🩺");
    expect(bankCategoryIcon("Logement  -  Maison")).toBe(bankCategoryIcon("Logement - maison"));
  });

  it("gives unknown names no emoji", () => {
    expect(bankCategoryIcon("Hyper")).toBeNull();
    expect(bankCategoryIcon("")).toBeNull();
  });

  it("stores its keys already normalized", () => {
    for (const [name] of bankCategoryIconEntries()) expect(normalizeBankCategoryName(name)).toBe(name);
  });
});
