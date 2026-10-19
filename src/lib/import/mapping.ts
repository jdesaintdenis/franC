import { z } from "zod";

import { parseCsvAmount } from "./amount";
import { DATE_FORMATS, parseDateAs, type DateFormat } from "./date";
import { normalizeLabel } from "./normalize-label";
import type { CsvTable } from "./table";

// Client-safe: the Columns step imports this file, so no node:crypto and no "./index".

const column = z.string().trim().min(1).max(200);

/** Which of the file's columns hold what, by column NAME so it survives a column moving. */
export const csvMappingSchema = z.object({
  date: column,
  label: column,
  amount: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("single"), column }),
    z.object({ kind: z.literal("split"), debit: column, credit: column }),
  ]),
  shortLabel: column.nullable(),
  bookedOn: column.nullable(),
  category: column.nullable(),
  subcategory: column.nullable(),
  dateFormat: z.enum(DATE_FORMATS),
  decimal: z.enum([",", "."]),
});
export type CsvMapping = z.infer<typeof csvMappingSchema>;

/** The Columns step's working state: every choice may still be empty. */
export interface MappingDraft {
  date: string | null;
  label: string | null;
  amountKind: "single" | "split";
  amount: string | null;
  debit: string | null;
  credit: string | null;
  shortLabel: string | null;
  bookedOn: string | null;
  category: string | null;
  subcategory: string | null;
  dateFormat: DateFormat;
  decimal: "," | ".";
}

/** Same accent- and case-insensitive match as labels, so "Libellé" finds "LIBELLE". */
function key(name: string): string {
  return normalizeLabel(name.replace(/[’‘]/g, "'").replace(/[_.-]/g, " "));
}

/** Index of the first column with this name, or -1. A repeated header name maps to its first column. */
export function columnIndex(headers: readonly string[], name: string): number {
  const wanted = key(name);
  return headers.findIndex((h) => key(h) === wanted);
}

const EXACT = {
  shortLabel: ["LIBELLE SIMPLIFIE", "LIBELLE COURT"],
  bookedOn: ["DATE DE COMPTABILISATION", "DATE COMPTABLE", "BOOKING DATE"],
  subcategory: ["SOUS CATEGORIE", "SUBCATEGORY", "SUB CATEGORY"],
  label: ["LIBELLE OPERATION", "LIBELLE", "LABEL", "DESCRIPTION", "INTITULE", "DETAIL", "WORDING", "MOTIF"],
  date: ["DATE OPERATION", "DATE D'OPERATION", "DATE DE L'OPERATION", "DATE OPE", "DATE", "TRANSACTION DATE"],
  category: ["CATEGORIE", "CATEGORY"],
  debit: ["DEBIT"],
  credit: ["CREDIT"],
  amount: ["MONTANT", "AMOUNT"],
} as const;

const CONTAINS = {
  label: (h: string) => h.includes("LIBELLE") || h.includes("DESCRIPTION"),
  date: (h: string) => h.includes("DATE") && !h.includes("VALEUR") && !h.includes("VALUE"),
  debit: (h: string) => h.includes("DEBIT"),
  credit: (h: string) => h.includes("CREDIT"),
  amount: (h: string) => h.includes("MONTANT") || h.includes("AMOUNT"),
} as const;

const SAMPLE_VALUES = 20;

function sampleValues(table: CsvTable, index: number): string[] {
  if (index < 0) return [];
  return table.rows
    .slice(0, SAMPLE_VALUES)
    .map(({ cells }) => (cells[index] ?? "").trim())
    .filter((v) => v !== "");
}

/** Best guess from the header names alone; every field stays empty when nothing fits. */
export function guessMapping(table: CsvTable): MappingDraft {
  const keys = table.headers.map(key);
  const taken = new Set<number>();
  const take = (index: number): string | null => {
    if (index < 0) return null;
    taken.add(index);
    return table.headers[index];
  };
  const exact = (names: readonly string[]) => take(keys.findIndex((k, i) => !taken.has(i) && names.includes(k)));
  const contains = (test: (h: string) => boolean) => take(keys.findIndex((k, i) => !taken.has(i) && test(k)));

  const shortLabel = exact(EXACT.shortLabel);
  const bookedOn = exact(EXACT.bookedOn);
  const subcategory = exact(EXACT.subcategory);
  let label = exact(EXACT.label);
  let date = exact(EXACT.date);
  const category = exact(EXACT.category);
  let debit = exact(EXACT.debit);
  let credit = exact(EXACT.credit);
  let amount = exact(EXACT.amount);
  label ??= contains(CONTAINS.label);
  date ??= contains(CONTAINS.date);
  debit ??= contains(CONTAINS.debit);
  credit ??= contains(CONTAINS.credit);
  amount ??= contains(CONTAINS.amount);

  // A file with only a short label still has a label.
  const labelColumn = label ?? shortLabel;
  const split = debit !== null && credit !== null;

  const dateValues = date === null ? [] : sampleValues(table, columnIndex(table.headers, date));
  const dateFormat =
    dateValues.length === 0 ? DATE_FORMATS[0] : (DATE_FORMATS.find((f) => dateValues.every((v) => parseDateAs(v, f) !== null)) ?? DATE_FORMATS[0]);

  const amountColumns = split ? [debit, credit] : [amount];
  const amountValues = amountColumns.flatMap((c) => (c === null ? [] : sampleValues(table, columnIndex(table.headers, c))));
  const decimal = amountValues.some((v) => /,\d{1,2}\s*(€|EUR)?$/i.test(v))
    ? ","
    : amountValues.some((v) => /\.\d{1,2}\s*(€|EUR)?$/i.test(v))
      ? "."
      : ",";

  return {
    date,
    label: labelColumn,
    amountKind: split ? "split" : "single",
    amount,
    debit: split ? debit : null,
    credit: split ? credit : null,
    shortLabel: label === null ? null : shortLabel,
    bookedOn,
    category,
    subcategory,
    dateFormat,
    decimal,
  };
}

export function toDraft(m: CsvMapping): MappingDraft {
  return {
    date: m.date,
    label: m.label,
    amountKind: m.amount.kind,
    amount: m.amount.kind === "single" ? m.amount.column : null,
    debit: m.amount.kind === "split" ? m.amount.debit : null,
    credit: m.amount.kind === "split" ? m.amount.credit : null,
    shortLabel: m.shortLabel,
    bookedOn: m.bookedOn,
    category: m.category,
    subcategory: m.subcategory,
    dateFormat: m.dateFormat,
    decimal: m.decimal,
  };
}

/** Null while date, label or the amount column(s) are still missing. */
export function completeMapping(d: MappingDraft): CsvMapping | null {
  if (d.date === null || d.label === null) return null;
  let amount: CsvMapping["amount"];
  if (d.amountKind === "single") {
    if (d.amount === null) return null;
    amount = { kind: "single", column: d.amount };
  } else {
    if (d.debit === null || d.credit === null) return null;
    amount = { kind: "split", debit: d.debit, credit: d.credit };
  }
  return {
    date: d.date,
    label: d.label,
    amount,
    shortLabel: d.shortLabel,
    bookedOn: d.bookedOn,
    category: d.category,
    subcategory: d.subcategory,
    dateFormat: d.dateFormat,
    decimal: d.decimal,
  };
}

/** Every column the mapping names, in the order date, label, amount(s). */
function requiredColumns(m: CsvMapping): string[] {
  return [m.date, m.label, ...(m.amount.kind === "single" ? [m.amount.column] : [m.amount.debit, m.amount.credit])];
}

/**
 * What the step opens with: the first remembered mapping (this account's, then the latest on any
 * account) whose date, label and amount columns all exist in this file, taken as a whole so its
 * date format and decimal mark stay with its columns; otherwise a guess from the header names.
 * An optional column the file no longer has falls back to the guess.
 */
export function prefillMapping(
  table: CsvTable,
  saved: CsvMapping | null,
  latest: CsvMapping | null,
): { draft: MappingDraft; remembered: boolean } {
  const guess = guessMapping(table);
  const has = (name: string | null) => name !== null && columnIndex(table.headers, name) >= 0;
  const source = [saved, latest].find((m) => m !== null && requiredColumns(m).every(has));
  if (!source) return { draft: guess, remembered: false };

  const draft = toDraft(source);
  // Spelled as the file spells it, so the select shows its option.
  const asInFile = (name: string | null) => (name === null ? null : (table.headers[columnIndex(table.headers, name)] ?? null));
  return {
    remembered: true,
    draft: {
      ...draft,
      date: asInFile(draft.date),
      label: asInFile(draft.label),
      amount: asInFile(draft.amount),
      debit: asInFile(draft.debit),
      credit: asInFile(draft.credit),
      shortLabel: has(draft.shortLabel) ? asInFile(draft.shortLabel) : guess.shortLabel,
      bookedOn: has(draft.bookedOn) ? asInFile(draft.bookedOn) : guess.bookedOn,
      category: has(draft.category) ? asInFile(draft.category) : guess.category,
      subcategory: has(draft.subcategory) ? asInFile(draft.subcategory) : guess.subcategory,
    },
  };
}

/** Formats able to read a value, for the "Use <format>" suggestion on the first row. */
export function dateFormatsReading(value: string): DateFormat[] {
  return DATE_FORMATS.filter((f) => parseDateAs(value, f) !== null);
}

/** Exposed for the first-row check on the client. */
export { parseCsvAmount };
