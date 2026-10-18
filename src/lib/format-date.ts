import { formattingLocale, type Locale } from "@/i18n/config";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight UTC of an ISO date; formatted in UTC below, so the day never shifts. */
function utcDay(iso: string): Date | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

const DAY_MS = 86_400_000;
const intlCache = new Map<string, Intl.DateTimeFormat | Intl.RelativeTimeFormat>();

function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = intlCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(formattingLocale(locale), { ...options, timeZone: "UTC" });
    intlCache.set(key, f);
  }
  return f as Intl.DateTimeFormat;
}

function relativeDay(offset: number, locale: Locale): string {
  const key = `${locale}|relative`;
  let f = intlCache.get(key);
  if (!f) {
    f = new Intl.RelativeTimeFormat(formattingLocale(locale), { numeric: "auto" });
    intlCache.set(key, f);
  }
  const text = (f as Intl.RelativeTimeFormat).format(offset, "day");
  return text.charAt(0).toLocaleUpperCase(formattingLocale(locale)) + text.slice(1);
}

/**
 * A day as people say it, for lists: "Today", "Yesterday", "Tomorrow", else
 * "Mon 28 Sept" / "lun. 28 sept.", with the year only when it isn't `today`'s.
 * `today` is the user's current date (`currentDate`), both `YYYY-MM-DD`.
 */
export function formatDay(iso: string, today: string, locale: Locale): string {
  const day = utcDay(iso);
  const now = utcDay(today);
  if (!day || !now) return iso;
  const offset = Math.round((day.getTime() - now.getTime()) / DAY_MS);
  if (offset >= -1 && offset <= 1) return relativeDay(offset, locale);
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return dateFormat(locale, { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(day);
}

/**
 * A short day for sentences and tight spots ("as of 28 Sept", "next 5 Oct"):
 * no weekday and no "Today", with the year only when it isn't `today`'s.
 */
export function formatShortDay(iso: string, today: string, locale: Locale): string {
  const day = utcDay(iso);
  if (!day) return iso;
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return dateFormat(locale, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(day);
}

/**
 * "12 Oct 2025 → 29 Sept 2026": both ends carry the year when it differs between them
 * (or from `today`'s, as `formatShortDay`), so a range never reads ambiguously.
 */
export function formatDayRange(from: string, to: string, today: string, locale: Locale): string {
  const a = utcDay(from);
  const b = utcDay(to);
  if (!a || !b) return `${from} → ${to}`;
  const yearsDiffer = from.slice(0, 4) !== to.slice(0, 4);
  const fmt = (iso: string, day: Date) =>
    yearsDiffer
      ? dateFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(day)
      : formatShortDay(iso, today, locale);
  return `${fmt(from, a)} → ${fmt(to, b)}`;
}

// Pages render on the server (UTC on Vercel), so the zone is fixed to the
// user's rather than taken from the runtime.
const DISPLAY_TIME_ZONE = "Europe/Paris";

const dateTimeFormats = new Map<Locale, Intl.DateTimeFormat>();

/** A timestamp as short date and time in the display time zone. */
export function formatDateTime(d: Date, locale: Locale): string {
  let f = dateTimeFormats.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(formattingLocale(locale), {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: DISPLAY_TIME_ZONE,
    });
    dateTimeFormats.set(locale, f);
  }
  return f.format(d);
}

const dayInZone = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar day (`YYYY-MM-DD`) of an instant in the display time zone. */
export function zonedIsoDay(d: Date): string {
  const parts = Object.fromEntries(dayInZone.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** An instant as a short day ("12 Sept"), taken in the display time zone; see `formatShortDay`. */
export function formatShortInstant(d: Date, today: string, locale: Locale): string {
  return formatShortDay(zonedIsoDay(d), today, locale);
}

const timeFormats = new Map<Locale, Intl.DateTimeFormat>();

function timeOfDay(d: Date, locale: Locale): string {
  let f = timeFormats.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(formattingLocale(locale), {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: DISPLAY_TIME_ZONE,
    });
    timeFormats.set(locale, f);
  }
  return f.format(d);
}

/** An instant as short day and 24-hour time in the display time zone: "2 Oct 07:00" / "2 oct. 07:00". */
export function formatShortInstantTime(d: Date, today: string, locale: Locale): string {
  return `${formatShortInstant(d, today, locale)} ${timeOfDay(d, locale)}`;
}

/** Like `formatShortInstantTime`, but just "07:00" when the instant is on `today`. */
export function formatInstantTimeOrDay(d: Date, today: string, locale: Locale): string {
  return zonedIsoDay(d) === today ? timeOfDay(d, locale) : formatShortInstantTime(d, today, locale);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const relativeFormats = new Map<Locale, Intl.RelativeTimeFormat>();

/**
 * How long ago an instant was, for status lines: "now", "5 min. ago", "2 hr. ago", "3 days ago".
 * Pure in `now`, so the server computes it once per render and the client never has to agree on a clock.
 */
export function formatTimeAgo(d: Date, now: Date, locale: Locale): string {
  let f = relativeFormats.get(locale);
  if (!f) {
    f = new Intl.RelativeTimeFormat(formattingLocale(locale), { numeric: "auto", style: "short" });
    relativeFormats.set(locale, f);
  }
  const ms = Math.max(0, now.getTime() - d.getTime());
  if (ms < HOUR_MS) return f.format(-Math.floor(ms / MINUTE_MS), "minute");
  if (ms < DAY_MS) return f.format(-Math.floor(ms / HOUR_MS), "hour");
  return f.format(-Math.floor(ms / DAY_MS), "day");
}
