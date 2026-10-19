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

/**
 * An amount as a bank writes it -> integer cents, for the decimal mark the user chose. Currency
 * signs and spaces are dropped; the other mark only counts as a thousands separator in groups of
 * three ("1.234,56"), so "1.5" is refused rather than read as 15. More than two decimals is
 * refused too, never rounded: money does not go through a float.
 */
export function parseCsvAmount(input: string, decimal: "," | "."): number | null {
  const compact = input.replace(/€|EUR/gi, "").replace(/[\s\u00a0\u202f']/g, "");
  const thousands = decimal === "," ? "\\." : ",";
  const mark = decimal === "," ? "," : "\\.";
  const match = new RegExp(`^([+-]?)(\\d{1,3}(?:${thousands}\\d{3})+|\\d+)(?:${mark}(\\d+))?$`).exec(compact);
  if (!match) return null;
  const [, sign, whole, fraction] = match;
  const digits = whole.replace(/[.,]/g, "");
  return parseAmountToCents(`${sign}${digits}${fraction === undefined ? "" : `,${fraction}`}`);
}
