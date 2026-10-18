import { useSyncExternalStore } from "react";

import { defaultLocale, isLocale, type Locale } from "@/i18n/config";

// The browser language never changes while a page is open.
const subscribe = () => () => {};

function readBrowserLocale(): Locale {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const primary = tag.toLowerCase().split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return defaultLocale;
}

/**
 * Locale from the browser's language list, for pages that render without the
 * next-intl provider (global error) or are cached and served to users of either
 * language (offline). Renders the default locale on the server and on hydration,
 * then switches on the client.
 */
export function useBrowserLocale(): Locale {
  return useSyncExternalStore(subscribe, readBrowserLocale, () => defaultLocale);
}
