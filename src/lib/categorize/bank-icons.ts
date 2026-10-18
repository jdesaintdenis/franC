/**
 * Default emojis for the bank's top-level categories, given on "Create all"
 * (subcategories start without one and can get their own, SPEC §66). Keys are normalized names; a name
 * that isn't listed gets no emoji.
 */
const BANK_CATEGORY_ICONS: Readonly<Record<string, string>> = {
  alimentation: "🛒",
  "logement - maison": "🏠",
  transports: "🚗",
  "loisirs et vacances": "🎉",
  "shopping et services": "🛍️",
  "banque et assurances": "🏦",
  "transaction exclue": "🔁",
  sante: "🩺",
  revenus: "💶",
  epargne: "🐷",
  "impots et taxes": "🧾",
};

/** Lowercase, accents removed and spaces collapsed, so "Santé" and "SANTE" match. */
export function normalizeBankCategoryName(name: string): string {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function bankCategoryIcon(name: string): string | null {
  return BANK_CATEGORY_ICONS[normalizeBankCategoryName(name)] ?? null;
}

/** Every known name with its emoji, for the recolour migration's generator and tests. */
export function bankCategoryIconEntries(): readonly (readonly [string, string])[] {
  return Object.entries(BANK_CATEGORY_ICONS);
}
