import { normalizeLabel } from "./normalize-label";

export interface BankCategoryPair {
  category: string | null;
  subcategory: string | null;
}

const PLACEHOLDER = "A CATEGORISER";

function clean(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * Turns the bank's raw category columns into what we keep. Some banks write
 * "A categoriser - ..." (category) and "... - a categoriser" (subcategory) when they
 * have not categorized a row: those are "no category", not real ones (harmless for banks that never do).
 * Comparison is accent- and case-insensitive (via normalizeLabel).
 */
export function cleanBankCategory(raw: BankCategoryPair): BankCategoryPair {
  const category = clean(raw.category);
  // A subcategory only makes sense under a category.
  if (category === null) return { category: null, subcategory: null };
  if (normalizeLabel(category).startsWith(PLACEHOLDER)) return { category: null, subcategory: null };
  const subcategory = clean(raw.subcategory);
  if (subcategory !== null && normalizeLabel(subcategory).endsWith(PLACEHOLDER)) {
    return { category, subcategory: null };
  }
  return { category, subcategory };
}
