/// <reference lib="webworker" />

import { defaultCache } from "@serwist/next/worker";
import { ExpirationPlugin, NetworkOnly, Serwist, StaleWhileRevalidate } from "serwist";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";

import {
  SHARE_CACHE,
  SHARE_TARGET_PATH,
  SHARED_FILE_KEY,
  SHARED_FILENAME_HEADER,
  SHARED_PARAM,
} from "@/lib/import/shared-file";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

// Only public, user-independent static assets may be cached at runtime.
const STATIC_ASSET_CACHES = new Set([
  "google-fonts-webfonts",
  "google-fonts-stylesheets",
  "static-font-assets",
  "static-image-assets",
  "next-static-js-assets",
  "next-image",
  "static-audio-assets",
  "static-video-assets",
  "static-js-assets",
  "static-style-assets",
]);

// Serwist's defaultCache also caches HTML, RSC payloads and /api responses
// (NetworkFirst). Those contain financial data, so we keep only the static
// asset entries and drop the rest.
const staticAssetCache: RuntimeCaching[] = defaultCache.filter(
  ({ handler }) =>
    "cacheName" in handler &&
    typeof handler.cacheName === "string" &&
    STATIC_ASSET_CACHES.has(handler.cacheName),
);

// Everything user-specific goes straight to the network and is never stored,
// so nothing sensitive persists in Cache Storage or is served stale offline.
const networkOnly = (matcher: RuntimeCaching["matcher"]): RuntimeCaching => ({
  matcher,
  handler: new NetworkOnly(),
});

// Emoji picker data (src/app/api/emoji-data): public, user-independent and large, so it is
// cached to keep the picker working offline after its first use. Listed before the /api/
// rule below, which would otherwise send it straight to the network.
const emojiData: RuntimeCaching = {
  matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/api/emoji-data/"),
  handler: new StaleWhileRevalidate({
    cacheName: "emoji-data",
    plugins: [new ExpirationPlugin({ maxEntries: 8, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
};

const runtimeCaching: RuntimeCaching[] = [
  networkOnly(({ request }) => request.mode === "navigate" || request.destination === "document"),
  networkOnly(({ request }) => request.headers.get("RSC") === "1"),
  emojiData,
  networkOnly(({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/api/")),
  ...staticAssetCache,
  // Catch-all for any other same-origin request (e.g. server action posts).
  networkOnly(({ sameOrigin }) => sameOrigin),
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

// Purges financial data cached by earlier service worker versions, which used
// NetworkFirst caches for pages, RSC payloads and API responses.
// The share-target cache is cleared too, in case a shared file was never picked up.
const LEGACY_CACHES = ["pages", "pages-rsc", "pages-rsc-prefetch", "apis", "others", SHARE_CACHE];
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all(LEGACY_CACHES.map((name) => caches.delete(name))));
});

// A CSV shared to the installed app (manifest share_target) arrives as a POST. The file is
// parked in its own cache for the import page, which deletes it as soon as it reads it
// (src/lib/import/shared-file.ts). Registered before Serwist's listener, which only routes GETs.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== SHARE_TARGET_PATH) return;
  event.respondWith(
    (async () => {
      const target = new URL(`/import?${SHARED_PARAM}=1`, self.location.origin);
      try {
        const file = (await event.request.formData()).get("file");
        if (file instanceof File && file.size > 0) {
          const cache = await caches.open(SHARE_CACHE);
          await cache.put(
            SHARED_FILE_KEY,
            new Response(file, {
              headers: { "Content-Type": file.type || "text/csv", [SHARED_FILENAME_HEADER]: encodeURIComponent(file.name) },
            }),
          );
        }
      } catch {
        // Unreadable share: the import page opens with its normal file picker.
      }
      return Response.redirect(target.href, 303);
    })(),
  );
});

serwist.addEventListeners();

interface PushPayload {
  title?: unknown;
  body?: unknown;
  url?: unknown;
}

/** Only same-origin relative paths; anything else falls back to the app root. */
function safeUrl(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

// Payload is generic (no account names or amounts). Nothing is cached here.
self.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    payload = (event.data?.json() ?? {}) as PushPayload;
  } catch {
    // Non-JSON payload: show the fallback title below.
  }
  const title = typeof payload.title === "string" ? payload.title : "franC";
  const body = typeof payload.body === "string" ? payload.body : undefined;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/192",
      badge: "/icons/192",
      data: { url: safeUrl(payload.url) },
      tag: "import-reminder",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: unknown } | null;
  const url = safeUrl(data?.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        await existing.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
