# PWA and offline

franC installs on a phone like an app and still opens without a connection, without ever storing financial data in the browser cache.

## Using it

- Open the deployed URL on your phone and use **Add to Home Screen**. It opens standalone, with its own icon and theme color.
- Navigation: a bottom bar on phones (Home, Transactions with the review badge, a raised Import button, Plan, More) and a left sidebar from 1024 px; see [Navigation](navigation.md).
- When the connection drops, an **offline banner** appears. Navigating while offline shows the **offline page**.

## How it works

- **Manifest** (`src/app/manifest.ts`): name, icons (`icon.tsx`, `apple-icon.tsx`, `src/app/icons/`), standalone display; language and colors follow the active locale and the dark background.
- **Service worker** (Serwist, `src/app/sw.ts`):
  - caches **static assets only**;
  - pages, RSC payloads and `/api` are **network-only**, so no financial data ever lands in Cache Storage;
  - `/offline` is precached and served as the navigation fallback; it ships both languages and follows the OS theme;
  - emoji picker data (`/api/emoji-data`) is the exception: public and identical for everyone, cached stale-while-revalidate for 30 days;
  - legacy page caches from older service workers are purged on activation;
  - the **share target** (below) is handled here;
  - `push` and `notificationclick` handlers show the optional [import reminder](import-reminder.md) notification and open `/import` (same-origin paths only).
### Share target

- The manifest declares a `share_target` (`POST /import/share`, `multipart/form-data`, one CSV file), so on Android the installed app shows up in the share sheet for CSV files. iOS doesn't support share targets.
- The service worker answers that POST itself: it puts the file in a dedicated `share-target` cache under one fixed key and redirects to `/import?shared=1`. The server never sees the share POST.
- `/import?shared=1` takes the file out of the cache and **deletes it at once** (`takeSharedFile`, `src/lib/import/shared-file.ts`), then starts the preview as if the file had been chosen. So a bank export only sits in Cache Storage between the share and the page reading it; the cache is also cleared whenever a new service worker activates.
- Without the service worker (not installed, or not active yet), `/import/share` just redirects to `/import`.

- The service worker is only active in production builds, which is what `pnpm test:e2e` runs against (`pnpm test:e2e:dev` skips these tests).
- **Mobile-first** UI throughout; tap targets sized for phones.
- Lighthouse no longer has a PWA category; installability checks and scores are in `docs/lighthouse.md`.

## Code

- `src/app/sw.ts`, `src/app/manifest.ts`, `src/app/offline/`
- `src/lib/offline.ts`
- `src/lib/import/shared-file.ts`, `src/app/(app)/import/shared-import-flow.tsx`, `src/app/(app)/import/share/route.ts` (share target)
- `next.config.ts` (Serwist wiring)

## Tests

`src/lib/offline.test.ts`; `e2e/offline.spec.ts` (production build only).

## Related

`docs/deployment.md` · `docs/lighthouse.md` · `SPEC.md` §24
