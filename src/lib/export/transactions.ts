import { centsToDecimal } from "./amount";
import { number, text, type CsvCell } from "./csv";

export type CategorySourceCode = "manual" | "rule" | "bank" | "guess";

export interface ExportCategory {
  name: string;
  /** Null for a top-level category. */
  parentName: string | null;
}

export interface ExportPart {
  /** 1-based position among all the parts, even when only some are exported. */
  number: number;
  category: ExportCategory | null;
  amountCents: number;
}

export interface ExportTransaction {
  date: string;
  accountName: string;
  /** The merchant name, when the row carries one: it leads the `label` column. */
  merchantName: string | null;
  labelDisplay: string | null;
  labelRaw: string | null;
  amountCents: number;
  category: ExportCategory | null;
  categorySource: CategorySourceCode | null;
  bankCategory: string | null;
  bankSubcategory: string | null;
  /** The other leg's account name when in an internal transfer. */
  transferAccountName: string | null;
  /** Tag names, sorted alphabetically. */
  tags: string[];
  note: string | null;
  /** Set when split: the parts to write (all of them, or only those matching a category filter). */
  split: { total: number; parts: ExportPart[] } | null;
}

/** Column codes in file order; the route translates them into headers. */
export const TRANSACTION_COLUMNS = [
  "date",
  "account",
  "label",
  "amount",
  "category",
  "subcategory",
  "split",
  "transactionAmount",
  "transfer",
  "categorySource",
  "bankCategory",
  "bankSubcategory",
  "bankLabel",
  "tags",
  "note",
] as const;

export interface TransactionWords {
  categorySource(code: CategorySourceCode): string;
}

/** A top-level category fills Category only; a subcategory fills both. */
export function categoryCells(category: ExportCategory | null): [CsvCell, CsvCell] {
  if (!category) return [text(""), text("")];
  if (category.parentName === null) return [text(category.name), text("")];
  return [text(category.parentName), text(category.name)];
}

/** One line per transaction, or per part for a split one (its own category is never written). */
export function transactionLines(
  rows: ExportTransaction[],
  separator: "." | ",",
  words: TransactionWords,
): CsvCell[][] {
  const lines: CsvCell[][] = [];
  for (const row of rows) {
    const common = {
      date: text(row.date),
      account: text(row.accountName),
      label: text(row.merchantName ?? row.labelDisplay ?? row.labelRaw ?? ""),
      transfer: text(row.transferAccountName ?? ""),
      bankCategory: text(row.bankCategory ?? ""),
      bankSubcategory: text(row.bankSubcategory ?? ""),
      bankLabel: text(row.labelRaw ?? ""),
      // On every split line too, so filtering the spreadsheet by tag still sums correctly.
      tags: text(row.tags.join(", ")),
      note: text(row.note ?? ""),
    };
    const build = (
      amountCents: number,
      category: ExportCategory | null,
      source: CsvCell,
      split: CsvCell,
      full: CsvCell,
    ): CsvCell[] => {
      const [cat, sub] = categoryCells(category);
      return [
        common.date,
        common.account,
        common.label,
        number(centsToDecimal(amountCents, separator)),
        cat,
        sub,
        split,
        full,
        common.transfer,
        source,
        common.bankCategory,
        common.bankSubcategory,
        common.bankLabel,
        common.tags,
        common.note,
      ];
    };
    if (row.split) {
      for (const part of row.split.parts) {
        lines.push(
          build(
            part.amountCents,
            part.category,
            text(""),
            text(`${part.number}/${row.split.total}`),
            number(centsToDecimal(row.amountCents, separator)),
          ),
        );
      }
    } else {
      lines.push(
        build(
          row.amountCents,
          row.category,
          text(row.categorySource ? words.categorySource(row.categorySource) : ""),
          text(""),
          text(""),
        ),
      );
    }
  }
  return lines;
}
