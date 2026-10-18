import { describe, expect, it } from "vitest";
import { sortBanks } from "./ordering";

describe("sortBanks", () => {
  it("puts Caisse d'Epargne (any accent/case) first, then sorts the rest", () => {
    const names = sortBanks(
      ["Société Générale", "Banque Populaire", "caisse d'epargne Bretagne", "Caisse d’Épargne" , "Caisse d'Épargne Île-de-France", "BNP Paribas"].map((name) => ({ name })),
    ).map((b) => b.name);
    expect(names.slice(0, 2)).toEqual(["caisse d'epargne Bretagne", "Caisse d'Épargne Île-de-France"]);
    expect(names.slice(2)).toEqual(["Banque Populaire", "BNP Paribas", "Caisse d’Épargne", "Société Générale"]);
  });

  it("does not mutate its input", () => {
    const input = [{ name: "B" }, { name: "A" }];
    sortBanks(input);
    expect(input[0].name).toBe("B");
  });
});
