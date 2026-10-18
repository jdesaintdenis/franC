# Lighthouse

Run with `CHROME_PATH=<chrome> pnpm lighthouse` (builds, starts the production
server, audits with `@lhci/cli`, writes reports to the git-ignored
`.lighthouseci/`). Config: `lighthouserc.cjs`. Only public pages are audited;
authenticated pages are covered by the axe checks in `e2e/a11y.spec.ts`.

Thresholds: accessibility >= 0.95 and best-practices >= 0.9 (errors),
performance >= 0.8 (warning).

## Scores (2026-09-29)

| URL | Performance | Accessibility | Best practices | SEO |
| --- | --- | --- | --- | --- |
| `/login` | 1.00 | 1.00 | 1.00 | 1.00 |
| `/offline` | 0.99 | 1.00 | 1.00 | 1.00 |

Conditions: local production build, headless Chromium, default mobile preset
with simulated throttling, one run per URL, CSP enabled. Scores vary between
runs and machines.

## PWA installability

Lighthouse 12+ removed the PWA category, so installability is verified by:

1. Chrome DevTools -> Application -> Manifest and Service workers on the
   deployed app (manifest valid, icons present, service worker activated).
2. `pnpm test:e2e e2e/offline.spec.ts` (service worker registered,
   offline navigation shows `/offline` and no cached data). Result on
   2026-09-29: 3 passed.
3. Authenticated pages: axe checks in `e2e/a11y.spec.ts`.
