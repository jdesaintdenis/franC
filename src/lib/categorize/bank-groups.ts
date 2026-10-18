/** The fields of a stored mapping that the settings list needs. */
interface GroupableMapping {
  bankCategory: string;
  bankSubcategory: string | null;
}

export interface BankMappingGroup<T extends GroupableMapping> {
  bankCategory: string;
  /** The bank category's own mapping, if it has one. */
  own: T | null;
  subcategories: T[];
}

/**
 * Groups mappings by bank category for display, in first-seen order of the
 * (already sorted) input. A group may have only subcategory mappings.
 */
export function groupBankMappings<T extends GroupableMapping>(mappings: readonly T[]): BankMappingGroup<T>[] {
  const groups = new Map<string, BankMappingGroup<T>>();
  for (const mapping of mappings) {
    let group = groups.get(mapping.bankCategory);
    if (!group) {
      group = { bankCategory: mapping.bankCategory, own: null, subcategories: [] };
      groups.set(mapping.bankCategory, group);
    }
    if (mapping.bankSubcategory === null) group.own = mapping;
    else group.subcategories.push(mapping);
  }
  return [...groups.values()];
}
