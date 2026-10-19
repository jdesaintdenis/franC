import { z } from "zod";

import { parseCsvAmount } from "./amount";
import { cleanBankCategory } from "./bank-category";
import { parseDateAs } from "./date";
import { columnIndex, type CsvMapping } from "./mapping";
import { normalizeLabel } from "./normalize-label";
import type { CsvTable } from "./table";
import type { ParsedTransaction, ParseResult, RowError, RowIssue } from "./types";

// Client-safe (the Columns step parses the first row to show it): no node:crypto, no "./index".

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

/** Reads every row of the table with the user's mapping. Invalid rows are reported, never dropped. */
export function parseWithMapping(table: CsvTable, mapping: CsvMapping): ParseResult {
  const at = (name: string | null) => (name === null ? null : columnIndex(table.headers, name));
  const idx = {
    date: at(mapping.date),
    label: at(mapping.label),
    shortLabel: at(mapping.shortLabel),
    bookedOn: at(mapping.bookedOn),
    category: at(mapping.category),
    subcategory: at(mapping.subcategory),
    amount: mapping.amount.kind === "single" ? at(mapping.amount.column) : null,
    debit: mapping.amount.kind === "split" ? at(mapping.amount.debit) : null,
    credit: mapping.amount.kind === "split" ? at(mapping.amount.credit) : null,
  };
  if (Object.values(idx).some((i) => i === -1)) return { ok: false, fileError: "columnMissing" };

  const { dateFormat, decimal } = mapping;
  const isoDate = z.string().transform((value, ctx) => {
    const iso = parseDateAs(value, dateFormat);
    if (iso === null) {
      addRowIssue(ctx, { code: "invalidDate" });
      return z.NEVER;
    }
    return iso;
  });

  const rowSchema = z
    .object({
      date: isoDate,
      // An empty booking date is just absent; a filled one that does not read is an error.
      bookedOn: z.string().transform((value, ctx) => {
        if (value.trim() === "") return null;
        const iso = parseDateAs(value, dateFormat);
        if (iso === null) {
          addRowIssue(ctx, { code: "invalidDate" });
          return z.NEVER;
        }
        return iso;
      }),
      shortLabel: z.string(),
      label: z.string().transform((value, ctx) => {
        const trimmed = value.trim();
        if (trimmed === "") {
          addRowIssue(ctx, { code: "emptyLabel" });
          return z.NEVER;
        }
        return trimmed;
      }),
      amount: z.string().trim(),
      debit: z.string().trim(),
      credit: z.string().trim(),
    })
    .transform((row, ctx) => {
      let amountCents: number | null;
      if (mapping.amount.kind === "single") {
        amountCents = parseCsvAmount(row.amount, decimal);
      } else {
        // The column gives the sign, banks write it differently. A zero next to a real value is no value.
        let hasDebit = row.debit !== "";
        let hasCredit = row.credit !== "";
        if (hasDebit && hasCredit) {
          if (parseCsvAmount(row.debit, decimal) === 0) hasDebit = false;
          else if (parseCsvAmount(row.credit, decimal) === 0) hasCredit = false;
        }
        if (hasDebit === hasCredit) {
          addRowIssue(ctx, { code: "debitCreditExclusive" });
          return z.NEVER;
        }
        const cents = parseCsvAmount(hasDebit ? row.debit : row.credit, decimal);
        amountCents = cents === null ? null : hasDebit ? -Math.abs(cents) : Math.abs(cents);
      }
      if (amountCents === null) {
        addRowIssue(ctx, { code: "malformedAmount" });
        return z.NEVER;
      }
      return {
        date: row.date,
        bookedOn: row.bookedOn,
        amountCents: amountCents === 0 ? 0 : amountCents,
        labelRaw: row.label,
        labelSimplified: row.shortLabel.trim(),
        labelNormalized: normalizeLabel(row.label),
      };
    });

  const cell = (cells: string[], i: number | null) => (i === null ? "" : (cells[i] ?? ""));
  const transactions: ParsedTransaction[] = [];
  const errors: RowError[] = [];
  for (const { cells, line } of table.rows) {
    if (cells.length !== table.headers.length) {
      errors.push({ line, issues: [{ code: "columnCount", expected: table.headers.length, found: cells.length }] });
      continue;
    }
    const parsed = rowSchema.safeParse({
      date: cell(cells, idx.date),
      bookedOn: cell(cells, idx.bookedOn),
      shortLabel: cell(cells, idx.shortLabel),
      label: cell(cells, idx.label),
      amount: cell(cells, idx.amount),
      debit: cell(cells, idx.debit),
      credit: cell(cells, idx.credit),
    });
    if (!parsed.success) {
      errors.push({ line, issues: parsed.error.issues.map(toRowIssue) });
      continue;
    }
    const { category, subcategory } = cleanBankCategory({
      category: idx.category === null ? null : cell(cells, idx.category),
      subcategory: idx.subcategory === null ? null : cell(cells, idx.subcategory),
    });
    transactions.push({ line, ...parsed.data, bankCategory: category, bankSubcategory: subcategory });
  }
  return { ok: true, transactions, errors };
}
