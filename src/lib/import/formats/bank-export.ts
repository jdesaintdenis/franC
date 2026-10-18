import Papa from "papaparse";
import { z } from "zod";

import { parseAmountToCents } from "../amount";
import { cleanBankCategory } from "../bank-category";
import { parseFrDate } from "../date";
import { normalizeLabel } from "../normalize-label";
import type { CsvFormat, ParsedTransaction, RowError, RowIssue } from "../types";

export const BANK_EXPORT_HEADER = [
  "Date de comptabilisation",
  "Libelle simplifie",
  "Libelle operation",
  "Reference",
  "Informations complementaires",
  "Type operation",
  "Categorie",
  "Sous categorie",
  "Debit",
  "Credit",
  "Date operation",
  "Date de valeur",
  "Pointage operation",
] as const;

/** Carries the typed issue through Zod's custom `params`, so callers get codes, not prose. */
function addRowIssue(ctx: z.RefinementCtx, issue: RowIssue): void {
  ctx.addIssue({ code: "custom", message: issue.code, params: { rowIssue: issue } });
}

function isRowIssue(value: unknown): value is RowIssue {
  return typeof value === "object" && value !== null && "code" in value && typeof value.code === "string";
}

function toRowIssue(issue: z.core.$ZodIssue): RowIssue {
  if (issue.code === "custom" && issue.params && isRowIssue(issue.params.rowIssue)) return issue.params.rowIssue;
  return { code: "invalidRow" };
}

const frDate = z.string().transform((value, ctx) => {
  const iso = parseFrDate(value.trim());
  if (iso === null) {
    addRowIssue(ctx, { code: "invalidDate" });
    return z.NEVER;
  }
  return iso;
});

const rowSchema = z
  .object({
    bookingDate: frDate,
    labelSimplified: z.string(),
    labelRaw: z.string().transform((value, ctx) => {
      const trimmed = value.trim();
      if (trimmed === "") {
        addRowIssue(ctx, { code: "emptyLabel" });
        return z.NEVER;
      }
      return trimmed;
    }),
    debit: z.string().trim(),
    credit: z.string().trim(),
    operationDate: frDate,
  })
  .transform((row, ctx) => {
    const hasDebit = row.debit !== "";
    const hasCredit = row.credit !== "";
    if (hasDebit === hasCredit) {
      addRowIssue(ctx, { code: "debitCreditExclusive" });
      return z.NEVER;
    }
    const amountCents = parseAmountToCents(hasDebit ? row.debit : row.credit);
    if (amountCents === null) {
      addRowIssue(ctx, { code: "malformedAmount" });
      return z.NEVER;
    }
    if (hasDebit && amountCents > 0) {
      addRowIssue(ctx, { code: "debitPositive" });
      return z.NEVER;
    }
    if (hasCredit && amountCents < 0) {
      addRowIssue(ctx, { code: "creditNegative" });
      return z.NEVER;
    }
    return {
      date: row.operationDate,
      bookedOn: row.bookingDate,
      amountCents,
      labelRaw: row.labelRaw,
      labelSimplified: row.labelSimplified.trim(),
      labelNormalized: normalizeLabel(row.labelRaw),
    };
  });

function parse(text: string): ReturnType<CsvFormat["parse"]> {
  // Strip BOM defensively; decoding itself is the caller's concern.
  const clean = text.replace(/^\uFEFF/, "");
  // Keep blank lines so row index i maps to file line i + 1 (this format
  // never quotes fields, so no record spans several lines); skip them below.
  const { data } = Papa.parse<string[]>(clean, { delimiter: ";" });
  const lines = data
    .map((cells, i) => ({ cells, line: i + 1 }))
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ""));

  const header = lines[0]?.cells;
  if (
    !header ||
    header.length !== BANK_EXPORT_HEADER.length ||
    !BANK_EXPORT_HEADER.every((name, i) => header[i]?.trim() === name)
  ) {
    return { ok: false, fileError: "unrecognizedHeader" };
  }

  const transactions: ParsedTransaction[] = [];
  const errors: RowError[] = [];
  lines.slice(1).forEach(({ cells, line }) => {
    if (cells.length !== BANK_EXPORT_HEADER.length) {
      errors.push({
        line,
        issues: [{ code: "columnCount", expected: BANK_EXPORT_HEADER.length, found: cells.length }],
      });
      return;
    }
    const parsed = rowSchema.safeParse({
      bookingDate: cells[0],
      labelSimplified: cells[1],
      labelRaw: cells[2],
      debit: cells[8],
      credit: cells[9],
      operationDate: cells[10],
    });
    if (!parsed.success) {
      errors.push({ line, issues: parsed.error.issues.map(toRowIssue) });
      return;
    }
    const { category, subcategory } = cleanBankCategory({ category: cells[6], subcategory: cells[7] });
    transactions.push({ line, ...parsed.data, bankCategory: category, bankSubcategory: subcategory });
  });

  return { ok: true, transactions, errors };
}

export const bankExportFormat: CsvFormat = { id: "bank-export", parse };
