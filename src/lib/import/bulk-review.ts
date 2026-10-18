// Kept apart from plan.ts, which pulls in node:crypto: the client import flow uses this.

/** The result screen leads with one-button bulk review after a first import or a large one. */
export const BULK_REVIEW_MIN_ROWS = 50;

export function offersBulkReview(input: { firstImport: boolean; inserted: number }): boolean {
  return input.inserted > 0 && (input.firstImport || input.inserted >= BULK_REVIEW_MIN_ROWS);
}
