export const locales = ["en", "fr"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const LOCALE_COOKIE = "locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Narrows a string from next-intl (typed as our Locale via AppConfig, but plain string at runtime edges). */
export function asLocale(value: string): Locale {
  return isLocale(value) ? value : defaultLocale;
}

/** BCP 47 tag used for Intl: French keeps fr-FR; English is en-GB so dates stay day-first. */
export function formattingLocale(locale: Locale): string {
  return locale === "fr" ? "fr-FR" : "en-GB";
}

interface WeightedLanguage {
  language: string;
  q: number;
  order: number;
}

/** Parses an Accept-Language header into languages sorted by q (stable), dropping q=0 and "*". */
function parseAcceptLanguage(header: string): string[] {
  const entries: WeightedLanguage[] = [];
  header.split(",").forEach((part, order) => {
    const [tag, ...params] = part.trim().split(";");
    const language = tag.trim().toLowerCase();
    if (!language || language === "*") return;
    let q = 1;
    for (const param of params) {
      if (!/^\s*q\s*=/i.test(param)) continue;
      const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param);
      q = match ? Number(match[1]) : 0; // a malformed weight disqualifies the entry
    }
    if (Number.isNaN(q) || q <= 0) return;
    entries.push({ language, q, order });
  });
  return entries.sort((a, b) => b.q - a.q || a.order - b.order).map((e) => e.language);
}

function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const language of parseAcceptLanguage(header)) {
    const primary = language.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

/** Saved user preference, then cookie, then the browser's Accept-Language, then English. */
export function resolveLocale(input: {
  saved?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(input.saved)) return input.saved;
  if (isLocale(input.cookie)) return input.cookie;
  return matchAcceptLanguage(input.acceptLanguage) ?? defaultLocale;
}
