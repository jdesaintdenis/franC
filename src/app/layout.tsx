import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { THEME_COLOR } from "@/lib/theme-color";

// Self-hosted (served from our own origin), so the CSP needs no font host.
import "@fontsource-variable/figtree";
// The 50 F look on Home (SPEC §72): Manrope for text and numbers, Cinzel for titles, Cormorant for the hero amount.
import "@fontsource-variable/manrope";
import "@fontsource-variable/cinzel";
import "@fontsource/cormorant-garamond/700.css";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.metadata");
  return {
    title: "franC",
    description: t("description"),
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: "franC",
      statusBarStyle: "black",
    },
  };
}

export function generateViewport(): Viewport {
  return {
    themeColor: THEME_COLOR,
    width: "device-width",
    initialScale: 1,
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <html lang={locale} className="dark h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
