// Bank prefixes that describe the payment channel, not the merchant. Order
// matters: "VIR SEPA " and "VIR. " must be tried before the bare "VIR ".
const LEADING_NOISE = /^(?:CB|PRLV|VIR SEPA|VIR\.|VIR) /;
// Card payments end with " FACT ddmmyy": the date differs on every occurrence.
const TRAILING_CARD_DATE = /\s+FACT\s+\d{6}$/;
// Cash withdrawals carry a machine reference; all of them are one "merchant".
const CASH_WITHDRAWAL = /^RETRAIT DAB\b.*$/;
// Loan instalments end with "DU dd/mm/yy".
const TRAILING_DUE_DATE = /\s+DU\s+[\d/.-]+$/;
// Standalone digit or date tokens (never a token mixing letters and digits,
// which is usually part of a name such as "JEUX42").
const TRAILING_NUMERIC_TOKEN = /\s+[\d/.-]+$/;

/**
 * Stable grouping key for a normalized bank label: the label minus channel
 * prefixes and per-occurrence noise. The result is always a substring of the
 * input so a text search on the label finds every transaction of the group.
 * Never empty: falls back to the trimmed input.
 */
export function merchantKey(labelNormalized: string): string {
  const trimmed = labelNormalized.trim();
  let key = trimmed.replace(LEADING_NOISE, "");
  key = key.replace(TRAILING_CARD_DATE, "");
  key = key.replace(CASH_WITHDRAWAL, "RETRAIT DAB");
  key = key.replace(TRAILING_DUE_DATE, "");
  key = key.replace(TRAILING_NUMERIC_TOKEN, "");
  key = key.trim();
  return key === "" ? trimmed : key;
}
