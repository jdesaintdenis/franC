import type { Locale } from "@/i18n/config";

/**
 * Name of the bank account every user starts with, in the language they signed
 * up in. It is stored data the user can rename, not a UI label.
 */
export const DEFAULT_ACCOUNT_NAMES: Readonly<Record<Locale, string>> = {
  en: "Main account",
  fr: "Compte principal",
};
