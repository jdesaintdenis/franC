import { assignDedupeKeys } from "./dedupe";
import type { CsvMapping } from "./mapping";
import { parseWithMapping } from "./parse";
import type { CsvTable } from "./table";
import type { FileErrorCode, KeyedTransaction, RowError } from "./types";

export type PrepareResult =
  | { ok: true; transactions: KeyedTransaction[]; errors: RowError[]; rowsTotal: number }
  | { ok: false; fileError: FileErrorCode };

/** Reads a table with the user's column mapping and assigns dedupe keys. No DB access. */
export function prepareImport(table: CsvTable, accountId: string, mapping: CsvMapping): PrepareResult {
  const parsed = parseWithMapping(table, mapping);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    transactions: assignDedupeKeys(parsed.transactions, accountId),
    errors: parsed.errors,
    rowsTotal: parsed.transactions.length + parsed.errors.length,
  };
}

export * from "./dedupe";
export * from "./types";
export { readCsvTable } from "./table";
export type { CsvTable } from "./table";
export { csvMappingSchema, completeMapping, prefillMapping, guessMapping } from "./mapping";
export type { CsvMapping, MappingDraft } from "./mapping";
export { parseWithMapping } from "./parse";
export { normalizeLabel } from "./normalize-label";
export { decodeUpload } from "./decode";
export { buildImportPlan, cashFlows, dateRangeOf, sampleRows } from "./plan";
export { offersBulkReview, BULK_REVIEW_MIN_ROWS } from "./bulk-review";
export type { ImportPlan } from "./plan";
