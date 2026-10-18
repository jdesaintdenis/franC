import type { Locale } from "./config";

/** One JSON file per namespace under messages/{locale}/, so areas can be translated independently. */
export const NAMESPACES = ["common", "auth", "dashboard", "import", "transactions", "recurring", "settings", "export", "year", "plan"] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** Merges the namespace files into one object keyed by namespace. */
export async function loadMessages(locale: Locale) {
  const entries = await Promise.all(
    NAMESPACES.map(async (ns) => [ns, (await import(`../../messages/${locale}/${ns}.json`)).default] as const),
  );
  return Object.fromEntries(entries);
}
