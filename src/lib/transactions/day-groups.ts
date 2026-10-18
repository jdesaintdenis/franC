export type ListEntry<T> = { kind: "day"; date: string } | { kind: "row"; item: T; first: boolean; last: boolean };

/**
 * Flattens rows into day headers and rows for the virtualised list. The input is already
 * sorted (date desc, id desc), so equal dates are adjacent and we never re-sort.
 */
export function toListEntries<T extends { id: string; date: string }>(items: readonly T[]): ListEntry<T>[] {
  const entries: ListEntry<T>[] = [];
  let currentDate: string | null = null;
  items.forEach((item, index) => {
    const first = item.date !== currentDate;
    if (first) {
      entries.push({ kind: "day", date: item.date });
      currentDate = item.date;
    }
    // `first`/`last` let the 50 F day card round its corners on its first and last row.
    entries.push({ kind: "row", item, first, last: items[index + 1]?.date !== item.date });
  });
  return entries;
}

/** Indexes of the day headers, ascending. */
export function dayHeaderIndexes(entries: readonly ListEntry<unknown>[]): number[] {
  const indexes: number[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind === "day") indexes.push(index);
  });
  return indexes;
}

/**
 * The header pinned at the top: the last header at or before the first visible entry, or -1
 * when none is (the virtualiser's rangeExtractor always renders this index so it can stick).
 */
export function activeHeaderIndex(headerIndexes: readonly number[], firstVisibleIndex: number): number {
  let active = -1;
  for (const index of headerIndexes) {
    if (index > firstVisibleIndex) break;
    active = index;
  }
  return active;
}
