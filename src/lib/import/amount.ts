const AMOUNT_RE = /^([+-]?)(\d+)(?:,(\d{1,2}))?$/;

/**
 * Parses a French-formatted amount (`-66,50`, `+2896,40`, `5`) into integer
 * cents. String arithmetic only: floats must never touch money.
 */
export function parseAmountToCents(input: string): number | null {
  const match = AMOUNT_RE.exec(input);
  if (!match) return null;
  const [, sign, whole, decimals = ""] = match;
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  if (cents === 0) return 0;
  return sign === "-" ? -cents : cents;
}
