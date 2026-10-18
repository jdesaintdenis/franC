// "Today" for the tests is the Paris calendar day, the same rule as the app's `currentDate`
// (src/lib/dashboard/month.ts). The UTC day is one behind Paris between 22:00 (23:00 in winter)
// and midnight UTC, which made relative dates off by one at that hour. Self-contained
// (no app imports) because the fake bank server runs under tsx without the app's path aliases.

export function parisToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** `YYYY-MM-DD`, `days` before today in Paris. Date-string maths in UTC, so the machine's zone never shifts it. */
export function isoDaysAgo(days: number): string {
  const [year, month, day] = parisToday().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
}
