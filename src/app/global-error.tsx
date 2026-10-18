"use client";

import { useBrowserLocale } from "@/components/browser-language";

import en from "../../messages/en/auth.json";
import fr from "../../messages/fr/auth.json";

// Replaces the root layout, so there is no Tailwind, theme or NextIntl provider
// here: plain inline styles in the 50 F night colours (the app is dark only), and the language
// comes from the browser with both dictionaries imported statically.
// Never renders error.message (may carry data).
const dictionaries = { en: en.shell.globalError, fr: fr.shell.globalError };

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const locale = useBrowserLocale();
  const t = dictionaries[locale];

  return (
    <html lang={locale}>
      <head>
        <meta name="color-scheme" content="dark" />
        <title>franC</title>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 32,
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#04051a",
          color: "#eeeaff",
        }}
      >
        <h1 style={{ fontSize: 24, margin: 0 }}>{t.title}</h1>
        <p role="alert" style={{ margin: 0, maxWidth: 360, opacity: 0.75 }}>
          {t.description}
        </p>
        <button
          type="button"
          onClick={() => retry()}
          style={{
            height: 40,
            padding: "0 16px",
            borderRadius: 6,
            border: "1px solid currentColor",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          {t.retry}
        </button>
        {error.digest && (
          <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>
            {t.reference.replace("{digest}", error.digest)}
          </p>
        )}
      </body>
    </html>
  );
}
