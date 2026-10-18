# Testing

Unit and integration tests run with `pnpm test` (Vitest, against the `db-test` database). This page covers the end-to-end suite.

## End-to-end (Playwright)

```bash
pnpm test:e2e        # production build + next start, 4 workers
pnpm test:e2e:dev    # next dev, for quick iteration while writing a spec
pnpm test:e2e e2e/import.spec.ts   # one file
PW_WORKERS=1 pnpm test:e2e         # fewer workers on a small machine
```

Output uses the `dot` reporter: one dot per test, full details only for failures, then the totals. Open the HTML report (CI artifact, or `pnpm exec playwright show-report`) for per-test timings.

- **Production build by default.** `pnpm test:e2e` runs `pnpm build && pnpm start` unless a server is already up on port 3000, which it reuses (not on CI). Pages are compiled once and the service worker is active, so `e2e/offline.spec.ts` runs too; `test:e2e:dev` skips those tests. `e2e/global-setup.ts` stops the run if the reused server is a dev server while you asked for the production one, or the other way round, so a forgotten `next dev` can't skew results.
- **One user per worker.** `e2e/fixtures.ts` gives each worker its own user, `e2e+w<n>@example.com` (derived from `E2E_USER_EMAIL`). At worker start it deletes that user, which cascades to all their data, and recreates it with SQL: the user (welcome checklist already done), a password login and the default bank account. That bypasses sign-up, so these addresses need no `ALLOWED_EMAILS` entry. The worker then signs in once through the API and every test starts signed in. A spec that needs to be signed out uses `test.use({ storageState: { cookies: [], origins: [] } })`; one that signs out calls `signInFresh` first, so it ends its own session and not the worker's.
- **Parallelism.** 4 workers locally, 2 on CI (`PW_WORKERS` overrides). Spec files run in parallel; the tests inside a file keep their order. Specs in the same worker still share that worker's user, so a spec cleans up what it creates and uses unique names (`Date.now()`).
- **Only `e2e/first-run.spec.ts`** uses a different user, `e2e-new@example.com`, through the real sign-up; it must be in `ALLOWED_EMAILS`.

### Writing a spec

- Import `test` and `expect` from `./fixtures`, not from `@playwright/test`. The fixture's `page.goto` and `page.reload` wait until React has revealed every streamed Suspense boundary: until then the page holds a hidden copy of the content (`<div hidden id="S:n">`) and a locator can match both ("resolved to 2 elements").
- After confirming in an alert dialog, wait for the dialog to close before asserting the result. An open dialog hides the rest of the page from the accessibility tree, so `toBeHidden()` or `toHaveCount(0)` would pass before the action has run.
- Autosaving controls stay disabled while saving: wait for `toBeEnabled()` before navigating away.
- Don't rely on data from other specs (categories, accounts): create what the test needs.
- `sql` and `workerUser` fixtures are available for seeding data the UI can't create (see `e2e/import-reminder.spec.ts`).

### README media

`pnpm media:generate` runs `e2e/media/readme-media.spec.ts` (config: `playwright.media.config.ts`; `pnpm test:e2e` ignores it) and rewrites `docs/screenshots/`: six phone screenshots and `categorize.gif`. It imports the synthetic sample with its dates moved to the current month (`src/lib/import/shift-sample-dates.ts`), adds a few budgets and a goal, and fails if an email or `localhost` is on screen. Needs ffmpeg and an emoji font; run it after the 15th of a month so the current month is well filled.

### Fake Enable Banking server

Bank-connection specs never call a real bank. `playwright.config.ts` starts `e2e/helpers/fake-enable-banking-server.ts` (a `node:http` server, `createFakeEnableBanking` in `e2e/helpers/fake-enable-banking.ts`) on port 3100 as a second `webServer`, and starts the app with `ENABLE_BANKING_APP_ID`, `ENABLE_BANKING_PRIVATE_KEY` (base64 of the PEM) and `ENABLE_BANKING_API_ORIGIN=http://localhost:3100`.

- The config generates a throwaway RSA key pair at start (nothing on disk, nothing committed) and shares it with the workers through `FAKE_EB_PRIVATE_KEY_B64` / `FAKE_EB_PUBLIC_KEY_B64`. The fake reads `FAKE_EB_PORT`, `FAKE_EB_APP_ID` and `FAKE_EB_PUBLIC_KEY` (PEM or base64 of it).
- It checks the JWT like the real API (RS256, `kid` = app id, `iss`, `aud`, expiry) and answers 401 otherwise. It serves `/aspsps`, `/auth`, `/sessions`, `DELETE /sessions/:id` and `/health`, plus a "Fake bank" page at `/bank/login` with **Approve** and **Cancel** links that redirect back with `code` or `error=access_denied`. It always returns two accounts (Compte de cheques, Livret A). State lives in memory and nothing is logged.
- A reused app server keeps its own environment, so it has no fake-bank variables. Stop any running server on port 3000 before running bank-connection specs. With `PLAYWRIGHT_BASE_URL` pointing at another server, that server must be configured the same way by hand.

- **Control endpoints** (no JWT, like `/health`): `POST /control/balance` `{"amount": "2000.00"}` sets the closing balance; `POST /control/rate-limit` `{"uid": "<bank account uid>"}` makes that account's next transactions call answer 429 `ASPSP_RATE_LIMIT_EXCEEDED` (once). It sends an `identification_hash` per account, stable across sessions while the uids are not, so Reconnect matches by hash.
- **The daily cron.** `playwright.config.ts` gives the app `CRON_SECRET` (`E2E_CRON_SECRET`, default `e2e-cron-secret-0123456789`; a reused server needs the same value). `/api/cron/daily` syncs every user's links, so an auto fixture in `e2e/fixtures.ts` makes tests in `bank-*.spec.ts` files, and tests tagged `{ tag: "@bank" }`, run one at a time across workers (a Postgres advisory lock on its own connection; waiting doesn't count against the test timeout). Tag any new spec that seeds a connection (`e2e/helpers/bank-seed.ts`) or calls the cron.
- **Seeding a connection** with `seedConnection` (`e2e/helpers/bank-seed.ts`) avoids the connect flow: the fake serves the same transactions for any account uid. Sync on open runs on every page of a worker whose links are over 2 hours old, so seed `lastSyncedAgo` accordingly.

### CI

`.github/workflows/e2e.yml` runs `pnpm test:e2e` on every pull request and push to `main`, with a Postgres 16 service container and test-only secrets generated in the job. On failure the Playwright HTML report and traces are uploaded as the `playwright-report` artifact (7 days). To make a red suite block merging, mark the **E2E** check as required in the repository's branch protection for `main`.

### Reporting

Before calling work done, run the whole suite and report the counts ("118 passed, 0 failed"), naming every failing test even if it also fails on `main`. Once a PR is open, the E2E check is the number to report.

### Timings

Measured 2026-10-01 in a 4-CPU cloud container, fresh database, test run only (the production build adds about 75 s):

| Setup | Duration | Result |
| --- | --- | --- |
| Before: `next dev`, 1 worker, shared user | 11.8 min | 102 passed, 14 failed |
| Before: production build, 1 worker, shared user | 6.3 min | 113 passed, 6 failed |
| After: production build, 1 worker | 4.5 min | 118 passed |
| After: production build, 2 workers | 3.0 min | 117 passed, 1 failed (since fixed) |
| After: production build, 4 workers | 2.5 min | 118 passed (twice) |
