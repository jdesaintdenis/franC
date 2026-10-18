import { createHash } from "node:crypto";

/**
 * Self-hosted Emojibase data for the emoji picker (frimousse fetches
 * `${emojibaseUrl}/${locale}/data.json` and `.../messages.json`). Hosting it here keeps the
 * CSP at `connect-src 'self'` and lets the service worker cache it for offline use. Only the
 * two UI locales are served. The data is public and identical for everyone; the file names
 * contain a dot, so the auth proxy (src/proxy.ts) skips these paths on purpose.
 */
const LOADERS = {
  en: {
    "data.json": () => import("emojibase-data/en/data.json"),
    "messages.json": () => import("emojibase-data/en/messages.json"),
  },
  fr: {
    "data.json": () => import("emojibase-data/fr/data.json"),
    "messages.json": () => import("emojibase-data/fr/messages.json"),
  },
} as const;

interface Payload {
  body: string;
  etag: string;
}
const payloads = new Map<string, Promise<Payload>>();

function isLocale(value: string): value is keyof typeof LOADERS {
  return Object.hasOwn(LOADERS, value);
}

function isFile(locale: keyof typeof LOADERS, value: string): value is keyof (typeof LOADERS)[typeof locale] {
  return Object.hasOwn(LOADERS[locale], value);
}

function load(locale: keyof typeof LOADERS, file: keyof (typeof LOADERS)[typeof locale]): Promise<Payload> {
  const key = `${locale}/${file}`;
  let cached = payloads.get(key);
  if (!cached) {
    cached = LOADERS[locale][file]().then((module) => {
      const body = JSON.stringify(module.default);
      return { body, etag: `"${createHash("sha1").update(body).digest("hex")}"` };
    });
    payloads.set(key, cached);
  }
  return cached;
}

export async function GET(request: Request, ctx: RouteContext<"/api/emoji-data/[locale]/[file]">): Promise<Response> {
  const { locale, file } = await ctx.params;
  if (!isLocale(locale) || !isFile(locale, file)) return new Response(null, { status: 404 });

  const { body, etag } = await load(locale, file);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    // The picker revalidates by ETag; a day of freshness spares the round trip.
    "Cache-Control": "public, max-age=86400",
    ETag: etag,
  };
  if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
