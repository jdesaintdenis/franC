/** One validated bank row, before dedupe keys are assigned. */
export interface ParsedTransaction {
  /** 1-based line number in the source file (header = line 1). */
  line: number;
  /** ISO `YYYY-MM-DD` operation date (actual spend date). */
  date: string;
  /** ISO booking date from the bank ("Date de comptabilisation"); not part of the dedupe hash. */
  bookedOn?: string | null;
  /** Integer cents; negative = outflow, positive = inflow. */
  amountCents: number;
  labelRaw: string;
  labelSimplified: string;
  labelNormalized: string;
  /** The bank's own category, cleaned (placeholders removed). Never part of the dedupe hash. */
  bankCategory: string | null;
  bankSubcategory: string | null;
}

/** Why a row was rejected. Codes and params only: the UI translates them. */
export type RowIssue =
  | { code: "invalidDate" }
  | { code: "emptyLabel" }
  | { code: "debitCreditExclusive" }
  | { code: "malformedAmount" }
  | { code: "columnCount"; expected: number; found: number }
  | { code: "invalidRow" };

export interface RowError {
  line: number;
  issues: RowIssue[];
}

/** Why the whole file was rejected. */
export type FileErrorCode = "noTable" | "columnMissing";

export type ParseResult =
  | { ok: true; transactions: ParsedTransaction[]; errors: RowError[] }
  | { ok: false; fileError: FileErrorCode };

export type KeyedTransaction = ParsedTransaction & {
  dedupeHash: string;
  occurrenceIndex: number;
};
