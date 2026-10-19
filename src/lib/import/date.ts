const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * `DD/MM/YYYY` -> `YYYY-MM-DD`, or null if malformed / not a real calendar
 * date. Pure integer math: no `Date` object, so the day can never shift.
 */
export function parseFrDate(input: string): string | null {
  const match = DATE_RE.exec(input);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export const DATE_FORMATS = ["DD/MM/YYYY", "DD/MM/YY", "DD-MM-YYYY", "DD.MM.YYYY", "YYYY-MM-DD", "MM/DD/YYYY"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

// Day and month may be written without their leading zero ("1/9/2025").
const PATTERNS: Record<DateFormat, { re: RegExp; order: readonly ["d" | "m" | "y", "d" | "m" | "y", "d" | "m" | "y"] }> = {
  "DD/MM/YYYY": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ["d", "m", "y"] },
  "DD/MM/YY": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, order: ["d", "m", "y"] },
  "DD-MM-YYYY": { re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: ["d", "m", "y"] },
  "DD.MM.YYYY": { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: ["d", "m", "y"] },
  "YYYY-MM-DD": { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: ["y", "m", "d"] },
  "MM/DD/YYYY": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ["m", "d", "y"] },
};

/** A date written in a format the user chose -> `YYYY-MM-DD`, or null. Integer maths only, like `parseFrDate`. */
export function parseDateAs(input: string, format: DateFormat): string | null {
  const { re, order } = PATTERNS[format];
  const match = re.exec(input.trim());
  if (!match) return null;
  const parts = { d: 0, m: 0, y: 0 };
  order.forEach((key, i) => {
    parts[key] = Number(match[i + 1]);
  });
  // A two-digit year is read as 20YY: bank exports do not go back further.
  const year = format === "DD/MM/YY" ? 2000 + parts.y : parts.y;
  if (year < 1 || parts.m < 1 || parts.m > 12) return null;
  if (parts.d < 1 || parts.d > daysInMonth(year, parts.m)) return null;
  return `${String(year).padStart(4, "0")}-${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`;
}
