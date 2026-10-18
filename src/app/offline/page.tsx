"use client";

import { useEffect } from "react";

import { useBrowserLocale } from "@/components/browser-language";

import en from "../../../messages/en/auth.json";
import fr from "../../../messages/fr/auth.json";

// Precached by the service worker and served offline to users of either
// language, so it ships both dictionaries and picks one from the browser
// instead of relying on the request-time locale of whoever cached it.
const dictionaries = { en: en.shell.offline, fr: fr.shell.offline };

export default function OfflinePage() {
  const locale = useBrowserLocale();
  const t = dictionaries[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // The service worker precached this page with whatever theme was saved at
  // install time; it is served offline long after, so follow the OS instead.
  useEffect(() => {
    document.documentElement.classList.remove("light", "dark");
  }, []);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      <p className="text-muted-foreground max-w-sm">{t.description}</p>
      {/* Plain anchor on purpose: a full navigation, not a client-side transition. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 inline-flex h-10 items-center rounded-md px-4 text-sm font-medium"
      >
        {t.retry}
      </a>
    </main>
  );
}
