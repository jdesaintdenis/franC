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
