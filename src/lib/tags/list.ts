export interface TagLike {
  id: string;
  name: string;
}

/** Case-insensitive name order, ties broken by the exact name (same order as the DB queries). */
export function compareTagNames(a: TagLike, b: TagLike): number {
  const la = a.name.toLowerCase();
  const lb = b.name.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Adds a tag to a row's tags (no-op when already there), keeping the name order. */
export function withTag<T extends TagLike>(tags: T[], tag: T): T[] {
  if (tags.some((t) => t.id === tag.id)) return tags;
  return [...tags, tag].sort(compareTagNames);
}

/** Distinct tags across several rows' tags, in name order. */
export function distinctTags<T extends TagLike>(lists: T[][]): T[] {
  const byId = new Map<string, T>();
  for (const list of lists) for (const tag of list) byId.set(tag.id, tag);
  return [...byId.values()].sort(compareTagNames);
}

/** Distinct names (case-insensitive, first spelling wins) in name order. */
export function mergeTagNames(...lists: string[][]): string[] {
  const byLower = new Map<string, string>();
  for (const list of lists) for (const n of list) if (!byLower.has(n.toLowerCase())) byLower.set(n.toLowerCase(), n);
  return [...byLower.values()].sort((a, b) => compareTagNames({ id: "", name: a }, { id: "", name: b }));
}

/** A tag already known on some rows, by name (case-insensitive): bulk add can then show it before the server answers. */
export function findTagByName<T extends TagLike>(lists: T[][], name: string): T | null {
  const wanted = name.trim().toLowerCase();
  if (wanted === "") return null;
  for (const list of lists) for (const tag of list) if (tag.name.toLowerCase() === wanted) return tag;
  return null;
}
