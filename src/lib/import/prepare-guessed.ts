import { prepareImport, type PrepareResult } from "./index";
import { completeMapping, guessMapping } from "./mapping";
import { readCsvTable } from "./table";

/**
 * The import with the mapping guessed from the header names, as if the user accepted it untouched.
 * The app asks the user; this is for tests and fixtures that start from a CSV string.
 */
export function prepareImportGuessed(text: string, accountId: string): PrepareResult {
  const table = readCsvTable(text);
  if (!table) return { ok: false, fileError: "noTable" };
  const mapping = completeMapping(guessMapping(table));
  if (!mapping) return { ok: false, fileError: "columnMissing" };
  return prepareImport(table, accountId, mapping);
}
