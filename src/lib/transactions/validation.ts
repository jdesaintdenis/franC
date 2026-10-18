/** The parts of a row that say where its money went (SPEC §73 A). */
export interface DestinationRow {
  category: unknown | null;
  split: unknown | null;
  transfer: { status: "detected" | "confirmed" } | null;
  ignored: boolean;
}

/** A row says where its money went with a category, a split, a confirmed transfer, or by being ignored. */
export function hasDestination(row: DestinationRow): boolean {
  return row.category !== null || row.split !== null || row.transfer?.status === "confirmed" || row.ignored;
}

/** The ✓ and swipe-right validate only rows still to review that already say where the money went. */
export function canValidate(row: DestinationRow & { reviewed: boolean }): boolean {
  return !row.reviewed && hasDestination(row);
}
