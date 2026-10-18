import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { savedPreferences } from "@/lib/auth/preferences";

import { LOCALE_COOKIE, resolveLocale, type Locale } from "./config";
import { loadMessages } from "./messages";

export async function getActiveLocale(): Promise<Locale> {
  const [saved, jar, h] = await Promise.all([savedPreferences(), cookies(), headers()]);
  return resolveLocale({
    saved: saved.locale,
    cookie: jar.get(LOCALE_COOKIE)?.value,
    acceptLanguage: h.get("accept-language"),
  });
}

export default getRequestConfig(async () => {
  const locale = await getActiveLocale();
  return {
    locale,
    messages: await loadMessages(locale),
    // Pages render on the server (UTC on Vercel); dates follow the user's zone.
    timeZone: "Europe/Paris",
  };
});

