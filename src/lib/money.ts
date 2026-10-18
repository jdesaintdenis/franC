import { formattingLocale, type Locale } from "@/i18n/config";

const plain = new Map<Locale, Intl.NumberFormat>();
const signed = new Map<Locale, Intl.NumberFormat>();

function formatter(cache: Map<Locale, Intl.NumberFormat>, locale: Locale, signDisplay?: "exceptZero") {
  let f = cache.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(formattingLocale(locale), { style: "currency", currency: "EUR", signDisplay });
    cache.set(locale, f);
  }
  return f;
}

/** Display only: amounts stay integer cents everywhere else. */
export function formatCents(cents: number, locale: Locale): string {
  return formatter(plain, locale).format(cents / 100);
}

const whole = new Map<Locale, Intl.NumberFormat>();

/** Display only: euros rounded to the unit, for dense tables where cents would not fit. */
export function formatWholeCents(cents: number, locale: Locale): string {
  let f = whole.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(formattingLocale(locale), {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      // "negative" drops the sign when the value rounds to zero, so -40 cents is "€0", never "-€0".
      signDisplay: "negative",
    });
    whole.set(locale, f);
  }
  return f.format(cents / 100);
}

/** Like formatCents but marks inflows with "+", so income isn't distinguished by color alone. */
export function formatSignedCents(cents: number, locale: Locale): string {
  return formatter(signed, locale, "exceptZero").format(cents / 100);
}

const signedWhole = new Map<Locale, Intl.NumberFormat>();

/** Display only: whole euros with "+" for inflows, for estimates ("about +€2,850"). */
export function formatSignedWholeCents(cents: number, locale: Locale): string {
  let f = signedWhole.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(formattingLocale(locale), {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      signDisplay: "exceptZero",
    });
    signedWhole.set(locale, f);
  }
  return f.format(cents / 100);
}

const percents = new Map<Locale, Intl.NumberFormat>();

/** Display only: a whole-number percentage with an explicit "+" for increases. */
export function formatSignedPercent(ratio: number, locale: Locale): string {
  let f = percents.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(formattingLocale(locale), {
      style: "percent",
      maximumFractionDigits: 0,
      signDisplay: "exceptZero",
    });
    percents.set(locale, f);
  }
  return f.format(ratio);
}

const wholePercents = new Map<Locale, Intl.NumberFormat>();

/** Display only: a whole percent (0–100) in the locale's style, e.g. "32%" or "32 %". */
export function formatPercent(percent: number, locale: Locale): string {
  let f = wholePercents.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(formattingLocale(locale), {
      style: "percent",
      maximumFractionDigits: 0,
      signDisplay: "negative",
    });
    wholePercents.set(locale, f);
  }
  return f.format(percent / 100);
}

const compact = new Map<Locale, Intl.NumberFormat>();

/** Display only: "€2.9k" style amounts for tight spots; under 1,000 € whole euros. */
export function formatCompactCents(cents: number, locale: Locale): string {
  if (Math.abs(cents) < 100000) return formatWholeCents(cents, locale);
  let f = compact.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(formattingLocale(locale), {
      style: "currency",
      currency: "EUR",
      notation: "compact",
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
      signDisplay: "negative",
    });
    compact.set(locale, f);
  }
  return f.format(cents / 100);
}

/** Euros to the old franc: the fixed conversion rate of 1 January 1999 (a nod to the name, never adjusted for inflation). */
export const FRANCS_PER_EURO = 6.55957;

/** Whole francs, rounded half away from zero. Integer maths (cents × 655 957 ÷ 10⁷) so no float drift. */
export function centsToFrancs(cents: number): number {
  const whole = Math.floor((Math.abs(cents) * 655957 + 5_000_000) / 10_000_000);
  return cents < 0 ? -whole : whole;
}

const francs = new Map<Locale, Intl.NumberFormat>();

/** Display only: the franc amount as a grouped whole number, without the word "francs". */
export function formatFrancsNumber(cents: number, locale: Locale): string {
  let f = francs.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(formattingLocale(locale), { maximumFractionDigits: 0, signDisplay: "negative" });
    francs.set(locale, f);
  }
  return f.format(centsToFrancs(cents));
}
