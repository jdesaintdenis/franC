import { orderedCategoryOptions, type CategoryNode, type CategoryOption } from "./hierarchy";

/** Lower-case without accents, so "epicerie" finds "Épicerie". */
export function foldName(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

/**
 * Whether the picker offers "Create": a non-empty search that no category name equals
 * (accents and case ignored). `extraNames` are other rows the list shows (Uncategorized).
 */
export function canCreateFromSearch(names: readonly string[], query: string, extraNames: readonly string[] = []): boolean {
  const needle = foldName(query.trim());
  if (needle === "") return false;
  return ![...names, ...extraNames].some((name) => foldName(name.trim()) === needle);
}

/** The parent to pre-select: the one parent whose subcategories are the only matches, else null (top level). */
export function defaultCreateParentId(categories: readonly CategoryNode[], query: string): string | null {
  const needle = foldName(query.trim());
  if (needle === "") return null;
  const matches = categories.filter((c) => foldName(c.name).includes(needle));
  if (matches.length === 0 || matches.some((c) => c.parentId === null)) return null;
  const parents = new Set(matches.map((c) => c.parentId));
  if (parents.size !== 1) return null;
  const [parentId] = parents;
  // An orphan's dangling parent can't be picked.
  return categories.some((c) => c.id === parentId && c.parentId === null) ? (parentId ?? null) : null;
}

/** The picker option for a just-created category (label "Parent > Child" built like the server's). */
export function optionForCreated(created: CategoryNode, categories: readonly CategoryNode[], locale: string): CategoryOption {
  const option = orderedCategoryOptions([...categories, created], locale).find((o) => o.id === created.id);
  if (!option) throw new Error("created category missing from options");
  return option;
}
