/**
 * Integer cents to a plain decimal string by integer/string arithmetic (no float path):
 * -6650 -> "-66.50", -5 -> "-0.05". No thousands separator and no currency, for spreadsheets.
 */
export function centsToDecimal(cents: number, separator: "." | ","): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}${separator}${fraction}`;
}
