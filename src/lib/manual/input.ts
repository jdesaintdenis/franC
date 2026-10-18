import { isValidIsoDate } from "../balance/input";
import { parseBudgetAmount } from "../budgets/amount";

export const MANUAL_LABEL_MAX = 100;
const OLDEST_DATE = "2000-01-01";

export type ManualFormError =
  | "amountRequired"
  | "amountInvalid"
  | "amountNotPositive"
  | "amountTooLarge"
  | "labelRequired"
  | "labelTooLong"
  | "dateInvalid"
  | "dateFuture"
  | "dateTooOld";

export interface ManualInput {
  /** Negative for an expense, positive for an income. */
  amountCents: number;
  label: string;
  /** "YYYY-MM-DD". */
  date: string;
}

export type ManualFormResult = { ok: true; value: ManualInput } | { ok: false; error: ManualFormError };

/**
 * Validates the raw fields of the "Add a transaction" form. The amount is typed positive and the
 * direction decides the sign. Returns codes, never text.
 */
export function parseManualForm(
  fields: { amount: unknown; direction: unknown; label: unknown; date: unknown },
  context: { today: string },
): ManualFormResult {
  const amountText = typeof fields.amount === "string" ? fields.amount.slice(0, 40) : "";
  const amount = parseBudgetAmount(amountText);
  if (!amount.ok) {
    const error = (
      { invalid: "amountInvalid", not_positive: "amountNotPositive", too_large: "amountTooLarge" } as const
    )[amount.error];
    return { ok: false, error };
  }
  if (amount.cents === null) return { ok: false, error: "amountRequired" };

  const label = typeof fields.label === "string" ? fields.label.replace(/\s+/g, " ").trim() : "";
  if (label === "") return { ok: false, error: "labelRequired" };
  if (label.length > MANUAL_LABEL_MAX) return { ok: false, error: "labelTooLong" };

  const date = typeof fields.date === "string" ? fields.date.trim() : "";
  if (!isValidIsoDate(date)) return { ok: false, error: "dateInvalid" };
  // ISO strings compare correctly.
  if (date > context.today) return { ok: false, error: "dateFuture" };
  if (date < OLDEST_DATE) return { ok: false, error: "dateTooOld" };

  const sign = fields.direction === "income" ? 1 : -1;
  return { ok: true, value: { amountCents: sign * amount.cents, label, date } };
}

/** The amount field's text for an existing amount ("12,50"; sign dropped, the direction carries it). */
export function amountToInput(amountCents: number): string {
  const abs = Math.abs(amountCents);
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}
