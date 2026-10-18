/** The fields of a queue item that grouping needs. */
export interface GroupableItem {
  import: { id: string; filename: string; kind: "csv" | "sync"; uploadedAt: string; accountName: string };
}

export interface ReviewGroup<T extends GroupableItem> {
  importId: string;
  /** The file's name, or the bank's name for a sync run. */
  filename: string;
  kind: "csv" | "sync";
  accountName: string;
  /** ISO timestamp of the import's upload. */
  uploadedAt: string;
  items: T[];
}

/**
 * Splits an already-ordered queue into consecutive runs by import, keeping the order.
 * The queue is sorted by import, so a run is a whole import (or its part within the loaded page).
 */
export function groupByImport<T extends GroupableItem>(items: readonly T[]): ReviewGroup<T>[] {
  const groups: ReviewGroup<T>[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.importId === item.import.id) {
      last.items.push(item);
    } else {
      groups.push({
        importId: item.import.id,
        filename: item.import.filename,
        kind: item.import.kind,
        accountName: item.import.accountName,
        uploadedAt: item.import.uploadedAt,
        items: [item],
      });
    }
  }
  return groups;
}
