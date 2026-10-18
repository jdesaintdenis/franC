# Security and privacy

How franC keeps one user's financial data private and out of logs.

## How it works

- **Authentication everywhere**: every page and API route except login/signup, auth endpoints and PWA assets requires a session. `requireUser()` is the authoritative check in the `(app)` layout, every server action and every route handler; `src/proxy.ts` is only an optimistic cookie check. See [Authentication](authentication.md).
- **User scoping**: every query touching user data filters by `user_id`. Composite foreign keys `(id, user_id)` make it impossible to link one user's row to another user's category, account, transaction or goal. `src/db/queries/scoping.test.ts` proves user A never sees or changes user B's data.
- **Input validation**: forms, uploads and query params are validated with Zod. Invalid URL filters are dropped.
- **No financial data in logs**: labels, amounts, notes and transaction data are never logged. `src/instrumentation.ts` redacts DB errors before they reach logs; server actions are wrapped with `withActionErrors` (`src/lib/actions/safe-action.ts`) so failures return a generic message; post-import steps log fixed lines only; exports log nothing.
- **Security headers** (`src/lib/security/headers.ts`): CSP (`connect-src 'self'`; `'unsafe-inline'` scripts because Next inlines its bootstrap; `'unsafe-eval'` dev only), frame, referrer, content-type and permissions headers.
- **No data in the browser cache**: the service worker never caches pages or API responses (see [PWA and offline](pwa-offline.md)). Exports are `Cache-Control: no-store`.
- **CSV export formula guard** against spreadsheet injection (see [Export](export.md)).
- **Guards**: tests refuse to run against anything but the `db-test` database; `db:reset` refuses production-looking URLs; `commitImport` re-checks account ownership.
- **Secrets** come from environment variables only (`.env.local`, git-ignored; `.env.example` documents them). Real bank CSVs are git-ignored; only the synthetic sample live in `docs/samples/`.
- **Hosting and backups**: Neon Postgres in the EU (point-in-time restore) and a nightly age-encrypted backup stored in a private Vercel Blob store. The backup runs in a READ ONLY transaction and logs only counts and step names. The auth base URL defaults to the Vercel production domain when `BETTER_AUTH_URL` is unset. See `docs/deployment.md`, `docs/backups.md` and `SECURITY.md` (how to report a vulnerability).
- **No external services** process transaction data (category guessing is local). The one outside service is Enable Banking, for bank sync: franC never sees bank credentials, only the emails in `BANK_SYNC_EMAILS` can use it, the bank callback is tied to the signed-in user by a one-time state, and only the last 4 IBAN characters are stored. See [Bank sync](bank-sync.md).

## Code

`src/lib/auth/`, `src/proxy.ts`, `src/lib/security/headers.ts`, `src/lib/logging/redact.ts`, `src/instrumentation.ts`, `src/lib/actions/safe-action.ts`.

## Tests

`src/db/queries/scoping.test.ts`, `src/lib/security/headers.test.ts`, `src/lib/logging/redact.test.ts`, `src/lib/actions/safe-action.test.ts`; `e2e/unauthenticated.spec.ts`.

## Related

`docs/security-review.md` · `SPEC.md` §11, §24
