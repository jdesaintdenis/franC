const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const isCaisse = (name: string) => fold(name).startsWith("caisse d'epargne");

/** Caisse d'Epargne first (the primary bank for this app), then the rest, each alphabetical. */
export function sortBanks<T extends { name: string }>(aspsps: readonly T[]): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "fr");
  return [
    ...aspsps.filter((a) => isCaisse(a.name)).sort(byName),
    ...aspsps.filter((a) => !isCaisse(a.name)).sort(byName),
  ];
}
