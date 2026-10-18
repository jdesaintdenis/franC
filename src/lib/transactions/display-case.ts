import type { Locale } from "@/i18n/config";

// Bank labels are French whatever the app language, so one set of joining words serves both
// locales; harmless English ones are included for labels that carry them.
const JOINING_WORDS = new Set([
  "de", "du", "des", "la", "le", "les", "et", "ou", "au", "aux", "en", "sur", "à", "par", "pour", "of", "and", "the", "at", "in", "on",
]);
// Elided articles that stay lower-case before an apostrophe ("D'Orléans").
const ELIDED = new Set(["d", "l"]);

// Digits, dots, "*", "/" and "@" mark references, URLs and card codes ("CB*1234", "WWW.SNCF.COM").
const KEEP_AS_IS = /[\d.*/@]/;

function capitalise(part: string, locale: Locale): string {
  const lower = part.toLocaleLowerCase(locale);
  const [first = "", ...rest] = Array.from(lower);
  return first.toLocaleUpperCase(locale) + rest.join("");
}

function convertWord(word: string, isFirst: boolean, locale: Locale): string {
  if (KEEP_AS_IS.test(word)) return word;
  if (!isFirst && JOINING_WORDS.has(word.toLocaleLowerCase(locale))) return word.toLocaleLowerCase(locale);
  // Keep hyphens and apostrophes as separators so each part is capitalised on its own.
  const parts = word.split(/([-'’])/);
  return parts
    .map((part, index) => {
      if (part === "" || /^[-'’]$/.test(part)) return part;
      const nextIsApostrophe = /^['’]$/.test(parts[index + 1] ?? "");
      if (!isFirst && index === 0 && nextIsApostrophe && ELIDED.has(part.toLocaleLowerCase(locale))) {
        return part.toLocaleLowerCase(locale);
      }
      return capitalise(part, locale);
    })
    .join("");
}

/**
 * Title-cases a bank label that is written in all capitals ("CARREFOUR CITY PARIS 15" ->
 * "Carrefour City Paris 15"). Labels that already have a lower-case letter, or no letter at
 * all, are returned unchanged. Acronyms cannot be told apart from words, so "PRLV SEPA EDF"
 * becomes "Prlv Sepa Edf"; merchant names are the fix for those.
 */
export function toDisplayCase(label: string, locale: Locale): string {
  if (!/\p{L}/u.test(label) || /\p{Ll}/u.test(label)) return label;
  let wordIndex = 0;
  return label
    .split(/(\s+)/)
    .map((token) => {
      if (token === "" || /^\s+$/.test(token)) return token;
      const converted = convertWord(token, wordIndex === 0, locale);
      wordIndex += 1;
      return converted;
    })
    .join("");
}
