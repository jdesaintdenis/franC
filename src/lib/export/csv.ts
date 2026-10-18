/**
 * A field. "text" is user or app text and gets the formula guard; "number" is a value we
 * formatted ourselves (amounts, priorities) and is written as is, so "-66.50" stays a number.
 */
export type CsvCell = { kind: "text"; value: string } | { kind: "number"; value: string };

export const text = (value: string): CsvCell => ({ kind: "text", value });
export const number = (value: string): CsvCell => ({ kind: "number", value });

export interface CsvOptions {
  delimiter: "," | ";";
}

const BOM = "\uFEFF";
const EOL = "\r\n";

// A spreadsheet runs a cell starting with one of these as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

function encode(cell: CsvCell, delimiter: string): string {
  const value = cell.kind === "text" && FORMULA_START.test(cell.value) ? `'${cell.value}` : cell.value;
  const needsQuotes = value.includes(delimiter) || /["\r\n]/.test(value);
  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Header (plain app text, guarded like any text cell) then rows. UTF-8 BOM so Excel reads
 * accents, CRLF after every line including the last. Not Papa's unparse: its formula escaping
 * would also prefix negative amounts.
 */
export function toCsv(header: string[], rows: CsvCell[][], { delimiter }: CsvOptions): string {
  const lines = [header.map((h) => text(h)), ...rows].map((row) =>
    row.map((cell) => encode(cell, delimiter)).join(delimiter),
  );
  return BOM + lines.map((line) => line + EOL).join("");
}
