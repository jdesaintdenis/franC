/**
 * Queries return `name: null` for money without a category, so no English
 * reaches the UI; pages swap in the translated label here.
 */
export function labelUncategorized<T extends { name: string | null }>(
  rows: readonly T[],
  label: string,
): (Omit<T, "name"> & { name: string })[] {
  return rows.map((r) => ({ ...r, name: r.name ?? label }));
}
