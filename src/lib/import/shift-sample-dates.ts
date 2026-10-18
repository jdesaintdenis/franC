// Moves the synthetic sample export forward so its last month is the month of `today`. Used by
// the README media generator (e2e/media) so Home and Budget show a populated current month.
// String maths only: transaction dates are SQL dates, never converted through `Date`.

const DATE_COLUMNS = [0, 10, 11];

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseDmy(value: string): { year: number; month: number; day: number } {
  const [day, month, year] = value.split("/").map(Number);
  return { year, month, day };
}

function shiftDmy(value: string, offsetMonths: number): string {
  const { year, month, day } = parseDmy(value);
  const index = year * 12 + (month - 1) + offsetMonths;
  const newYear = Math.floor(index / 12);
  const newMonth = (index % 12) + 1;
  const newDay = Math.min(day, daysInMonth(newYear, newMonth));
  return `${String(newDay).padStart(2, "0")}/${String(newMonth).padStart(2, "0")}/${newYear}`;
}

/** `today` is `YYYY-MM-DD`. Rows whose shifted booking date falls after `today` are dropped. */
export function shiftSampleToMonth(csv: string, today: string): string {
  const eol = csv.includes("\r\n") ? "\r\n" : "\n";
  const [header, ...rows] = csv.split(/\r?\n/).filter((line) => line !== "");
  const cells = rows.map((row) => row.split(";"));

  const lastMonth = Math.max(
    ...cells.map((c) => {
      const { year, month } = parseDmy(c[0]);
      return year * 12 + (month - 1);
    }),
  );
  const [ty, tm, td] = today.split("-").map(Number);
  const offset = ty * 12 + (tm - 1) - lastMonth;

  const kept: string[] = [];
  for (const row of cells) {
    for (const col of DATE_COLUMNS) if (row[col]) row[col] = shiftDmy(row[col], offset);
    const booking = parseDmy(row[0]);
    const bookingKey = booking.year * 10000 + booking.month * 100 + booking.day;
    if (bookingKey > ty * 10000 + tm * 100 + td) continue;
    kept.push(row.join(";"));
  }
  return [header, ...kept].join(eol) + eol;
}
