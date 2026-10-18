/**
 * Normalizes a bank label for hashing: strips accents, uppercases, collapses
 * whitespace.
 *
 * FROZEN once data exists: re-imports recompute hashes from the CSV with this
 * function, so changing it would make new hashes differ from stored ones and
 * would need a re-hash migration. This does not freeze displayed labels:
 * `dedupe_hash` is computed once at insert and never re-derived from DB
 * columns.
 */
export function normalizeLabel(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}
