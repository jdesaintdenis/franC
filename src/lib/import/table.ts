import Papa from "papaparse";

export interface CsvTable {
  /** The header row's cells, trimmed. */
  headers: string[];
  /** Every non-blank line after the header; `line` is the 1-based line in the file (blank lines count). */
  rows: { line: number; cells: string[] }[];
}

/**
 * Reads any CSV into a header and rows. The delimiter is detected. The header is the first line
 * whose cell count is the file's most common one, so a few lines of account information above the
 * table are skipped. Null when there is no table: fewer than 2 columns, or no row under the header.
 */
export function readCsvTable(text: string): CsvTable | null {
  const clean = text.replace(/^﻿/, "");
  // Blank lines stay in the parse so index i is file line i + 1; they are filtered below.
  const { data } = Papa.parse<string[]>(clean, {});
  const lines = data
    .map((cells, i) => ({ cells, line: i + 1 }))
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ""));

  const counts = new Map<number, number>();
  for (const { cells } of lines) counts.set(cells.length, (counts.get(cells.length) ?? 0) + 1);
  let width = 0;
  let best = 0;
  // Ties go to the wider table: a preamble line is narrower than the data.
  for (const [length, n] of counts) {
    if (n > best || (n === best && length > width)) {
      width = length;
      best = n;
    }
  }
  if (width < 2) return null;

  const headerAt = lines.findIndex(({ cells }) => cells.length === width && cells.filter((c) => c.trim() !== "").length >= 2);
  if (headerAt < 0 || headerAt === lines.length - 1) return null;
  return {
    headers: lines[headerAt].cells.map((cell) => cell.trim()),
    rows: lines.slice(headerAt + 1),
  };
}
