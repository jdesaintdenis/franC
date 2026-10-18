const DECIMAL_RE = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/;

/**
 * An API amount (`"12.3"`, `"1500.00"`) to integer cents, signed by the credit/debit indicator.
 * String arithmetic only: floats must never touch money. Null when malformed or the sign is unknown.
 */
export function bankAmountToCents(amount: string, indicator: string | null | undefined): number | null {
  const match = DECIMAL_RE.exec(amount.trim());
  if (!match) return null;
  const [, sign, whole, decimals = ""] = match;
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  if (cents === 0) return 0;
  // The API sends positive amounts with an indicator; a signed amount without one is taken as written.
  if (indicator === "DBIT") return -cents;
  if (indicator === "CRDT") return cents;
  if (!indicator && sign) return sign === "-" ? -cents : cents;
  return null;
}
