/** The fields the queue order and the current-row logic need. */
export interface OrderableItem {
  id: string;
  date: string;
  import: { id: string; uploadedAt: string };
}

/**
 * The order `listReviewQueue` uses: newest import first (then import id), newest date first,
 * then id. Restoring rows after Undo sorts with it so they land where they were.
 */
export function compareQueueItems(a: OrderableItem, b: OrderableItem): number {
  if (a.import.uploadedAt !== b.import.uploadedAt) return a.import.uploadedAt < b.import.uploadedAt ? 1 : -1;
  if (a.import.id !== b.import.id) return a.import.id < b.import.id ? -1 : 1;
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

/** Adds `restored` rows back to the queue in queue order, ignoring ones that are already there. */
export function mergeRestored<T extends OrderableItem>(items: readonly T[], restored: readonly T[]): T[] {
  const present = new Set(items.map((i) => i.id));
  const extra = restored.filter((r) => !present.has(r.id));
  return [...items, ...extra].sort(compareQueueItems);
}

/**
 * Which row to show after `removed` rows left the queue: if the current one stays, it; otherwise
 * the first remaining row after it, else the last remaining row before it; null when nothing is left.
 */
export function nextCurrentId(
  items: readonly { id: string }[],
  removed: ReadonlySet<string>,
  currentId: string | null,
): string | null {
  const remaining = items.filter((i) => !removed.has(i.id));
  if (remaining.length === 0) return null;
  if (currentId !== null && !removed.has(currentId) && items.some((i) => i.id === currentId)) return currentId;
  const at = items.findIndex((i) => i.id === currentId);
  if (at < 0) return remaining[0].id;
  const after = items.slice(at + 1).find((i) => !removed.has(i.id));
  if (after) return after.id;
  return remaining[remaining.length - 1].id;
}
