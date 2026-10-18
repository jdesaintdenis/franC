import { parseFrDate } from "../import/date";
import { normalizeLabel } from "../import/normalize-label";
import type { ParsedTransaction } from "../import/types";
import { bankAmountToCents } from "./amount";
import type { BankTransaction } from "./schemas";
import { shortLabelFor, type LearnedShortLabels } from "./short-label";

// What the real Caisse d'Épargne response showed (SPEC §62): one remittance line, equal to the
// CSV's "Libelle operation" plus a trailing reference on card payments and withdrawals, and only a
// booking date, while the CSV stores the operation date.

const TRAILING_REFERENCE: readonly RegExp[] = [
  /^(.*\bFACT \d{6}) \S*\d\S*$/i,
  /^(RETRAIT DAB \d{2}-\d{2}-\d+-\d+) \S*\d\S*$/i,
];

/** The bank's label as the CSV writes it: the reference the API appends is dropped. */
export function cleanBankLabel(remittance: string): string {
  const label = remittance.trim().replace(/\s+/g, " ");
  for (const pattern of TRAILING_REFERENCE) {
    const match = pattern.exec(label);
    if (match) return match[1];
  }
  return label;
}

const CARD_DATE = /\bFACT (\d{2})(\d{2})(\d{2})$/i;

/**
 * The operation date the CSV would show. A card payment's label ends with its date (`FACT ddmmyy`),
 * booked a few days later; anything else is booked the day it happens. The year comes from the
 * booking date, the year before when that would put the payment after its booking (December
 * payment booked in January).
 */
export function operationDate(cleanLabel: string, bookingDate: string): string {
  const match = CARD_DATE.exec(cleanLabel);
  if (!match) return bookingDate;
  const [, day, month] = match;
  const year = Number(bookingDate.slice(0, 4));
  for (const y of [year, year - 1]) {
    const iso = parseFrDate(`${day}/${month}/${String(y).padStart(4, "0")}`);
    if (iso && iso <= bookingDate) return iso;
  }
  return bookingDate;
}

export type SyncRow = ParsedTransaction & { externalId: string | null };
export type SyncRowIssue =
  | { code: "nonEur" }
  | { code: "malformedAmount" }
  | { code: "noDate" }
  | { code: "emptyLabel" };
export type SyncRowError = { line: number; issues: SyncRowIssue[] };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Banks fill unknown references with zeros or dashes; such a value would make unrelated rows collide.
const PLACEHOLDER_ID = /^[0\s-]*$/;

/** Reuses the CSV calendar check (no `Date`) by reformatting; null unless a real `YYYY-MM-DD`. */
function validIsoDate(value: string | null | undefined): string | null {
  const match = ISO_DATE.exec((value ?? "").trim());
  if (!match) return null;
  return parseFrDate(`${match[3]}/${match[2]}/${match[1]}`);
}

function filled(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function longLabel(tx: BankTransaction): string | null {
  const remittance = (tx.remittance_information ?? [])
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
  if (remittance !== "") return cleanBankLabel(remittance);
  const party = tx.credit_debit_indicator === "CRDT" ? tx.debtor : tx.creditor;
  const name = filled(party?.name);
  if (name) return cleanBankLabel(name);
  const description = filled(tx.bank_transaction_code?.description);
  return description ? cleanBankLabel(description) : null;
}

function rowDate(tx: BankTransaction, labelRaw: string): string | null {
  // transaction_date, when the bank gives it, is already the operation date.
  const direct = filled(tx.transaction_date);
  if (direct) return validIsoDate(direct);
  const booking = filled(tx.booking_date);
  if (booking) return validIsoDate(operationDate(labelRaw, booking));
  const value = filled(tx.value_date);
  return value ? validIsoDate(operationDate(labelRaw, value)) : null;
}

/**
 * Bank API transactions to the rows the CSV pipeline produces. Pending rows are skipped (counted);
 * invalid ones are reported with their 1-based position, never dropped silently.
 */
export function convertBankTransactions(
  transactions: readonly BankTransaction[],
  learned: LearnedShortLabels,
): { rows: SyncRow[]; errors: SyncRowError[]; skipped: number } {
  const idCounts = new Map<string, number>();
  for (const tx of transactions) {
    const id = filled(tx.entry_reference);
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }

  const rows: SyncRow[] = [];
  const errors: SyncRowError[] = [];
  let skipped = 0;

  transactions.forEach((tx, index) => {
    const line = index + 1;
    if (tx.status && tx.status !== "BOOK") {
      skipped += 1;
      return;
    }
    const issues: SyncRowIssue[] = [];
    if (tx.transaction_amount.currency !== "EUR") issues.push({ code: "nonEur" });
    const amountCents = bankAmountToCents(tx.transaction_amount.amount, tx.credit_debit_indicator);
    if (amountCents === null) issues.push({ code: "malformedAmount" });
    const labelRaw = longLabel(tx);
    if (labelRaw === null) issues.push({ code: "emptyLabel" });
    // Without a label the FACT derivation has nothing to read; fall back to the plain dates.
    const date = rowDate(tx, labelRaw ?? "");
    if (date === null) issues.push({ code: "noDate" });
    if (issues.length > 0 || amountCents === null || labelRaw === null || date === null) {
      errors.push({ line, issues });
      return;
    }

    const bookedOn = validIsoDate(tx.booking_date);
    const id = filled(tx.entry_reference);
    const reliable = id !== null && !PLACEHOLDER_ID.test(id) && idCounts.get(id) === 1;
    rows.push({
      line,
      date,
      bookedOn,
      amountCents,
      labelRaw,
      labelSimplified: shortLabelFor(labelRaw, learned),
      labelNormalized: normalizeLabel(labelRaw),
      bankCategory: null,
      bankSubcategory: null,
      externalId: reliable ? id : null,
    });
  });

  return { rows, errors, skipped };
}
