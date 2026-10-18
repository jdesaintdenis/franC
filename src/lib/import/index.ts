import { assignDedupeKeys } from "./dedupe";
import { bankExportFormat } from "./formats/bank-export";
import type { CsvFormat, FileErrorCode, KeyedTransaction, RowError } from "./types";

export type PrepareResult =
  | { ok: true; transactions: KeyedTransaction[]; errors: RowError[]; rowsTotal: number }
  | { ok: false; fileError: FileErrorCode };

/** Parses a decoded CSV string and assigns dedupe keys. No DB access. */
export function prepareImport(
  text: string,
  accountId: string,
  format: CsvFormat = bankExportFormat,
): PrepareResult {
  const parsed = format.parse(text);
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
export { bankExportFormat } from "./formats/bank-export";
export { normalizeLabel } from "./normalize-label";
export { decodeUpload } from "./decode";
export { buildImportPlan, cashFlows, dateRangeOf, sampleRows } from "./plan";
export { offersBulkReview, BULK_REVIEW_MIN_ROWS } from "./bulk-review";
export type { ImportPlan } from "./plan";
