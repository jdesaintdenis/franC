# Security review (Slice 11)

Date: 2026-09-29. Scope: the whole repository at the Slice 11 hardening step (queries, server actions, logging, secrets, headers, test/DB guards).

## Query scoping (`src/db/queries/**`)

| Module | Functions | Scoping |
| --- | --- | --- |
| accounts | listAccounts, getOwnedAccount | `user_id` in every WHERE |
| categories | list/create/update/delete, getCategoryUsage | `user_id` in every WHERE |
| category-rules | listRules, loadCompiledRules, createRule, updateRule, deleteRule, reorderRules, applyRulesToUncategorized | `user_id` in every WHERE; category ownership checked on create/update |
| dashboard | getMonthTotals, getSpendingByCategory, getMonthlyTrend, getLatestTransactionMonth | `user_id` on transactions; category join also scoped |
| imports | loadExistingDedupeKeys, listImports, undoImport | `user_id` in every WHERE |
| imports | commitImport | `user_id` on writes, and now self-checks that the account belongs to the user inside its transaction (throws `AccountNotOwnedError` before inserting) |
| provision | provisionUserDefaults | writes only for the given user |
| recurring | refreshRecurring, listRecurring, setRecurringStatus | `user_id` in every WHERE |
| transactions | listTransactions, setTransactionCategory, ... | `user_id` in every WHERE; category ownership checked |

`src/db/queries/scoping.test.ts` proves user A never sees or changes user B's accounts, categories, rules, transactions, recurring items and dashboard figures.

## Server actions

All actions under `src/app/**/actions.ts` call `requireUser()` and validate input with Zod. The only exceptions are the public auth actions (login, sign-up, which are guarded by the sign-up allowlist and Better Auth's rate limiter). `src/proxy.ts` is only an optimistic cookie check; it is not relied on for authorization.

## Logging

- Application code logs only fixed messages (one `console.error` with a constant string in the import actions); no labels, amounts or dates are interpolated.
- Uncaught errors are printed by Next. Drizzle's `DrizzleQueryError` message contains `params: ...`. `src/instrumentation.ts` wraps `console.error` and `console.warn` in the Node runtime and passes arguments through `redactConsoleArgs` (`src/lib/logging/redact.ts`). DB errors (including any in a `cause` chain) are reduced to name, SQLSTATE code and digest. Unit tests cover leaks via message, params, query, detail and cause chains.
- Not covered: output that bypasses `console` (direct stdout writes) and third-party libraries that capture `console.error` before `register()` runs.

## Secrets audit

- Tracked files: only `.env.example` matches `.env*`; the only tracked CSV is `docs/samples/sample-export.csv` (synthetic).
- Grep for `secret`, `password`, `postgres://`: hits are the documented local defaults in `.env.example`/`docker-compose.yml` (`franc:franc` on localhost) and E2E fixture credentials read from env with a dev-only fallback. No real credentials found.
- `.env.example` now documents every env var read by code, including the optional tooling ones (`FORCE_DB_RESET`, `E2E_PROD`, `PLAYWRIGHT_*`, `VERCEL_GIT_COMMIT_SHA`, `CI`).
- Better Auth already refuses to start in production with the default secret (`validateSecret` in `better-auth/dist/context/create-context.mjs`; an unset secret falls back to the default, which throws when `NODE_ENV=production`). No extra check was added.

## Headers and CSP

`next.config.ts` applies (via `src/lib/security/headers.ts`) HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a minimal `Permissions-Policy`, `X-Frame-Options: DENY` and a CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `worker-src 'self'`, etc.). Dev additionally allows `'unsafe-eval'` and `ws:`/`wss:` for HMR. Verified: full dev E2E suite and the production service-worker E2E pass under the CSP; `curl -I` on a production server shows all headers.

## Guards added

- `vitest.setup.ts` throws if `DATABASE_URL_TEST` is unset or equal to `DATABASE_URL` (no fallback to the dev database).
- `scripts/db-reset.ts` refuses unless the host is `localhost`, `127.0.0.1`, `::1` or `db`, unless `FORCE_DB_RESET=1`. The message names only the host.
- `commitImport` ownership check (see above), with a test.

## Accepted risks

- User-authored regex rules can only slow the author's own requests (patterns are limited to 200 characters and compile-checked); there is no cross-user impact in a single-user-per-data model.
- `categorizeTransaction` updates the category and creates a rule in separate transactions. A failure between them leaves a manual category without a rule, which is harmless.
- The CSP allows `'unsafe-inline'` scripts because Next inlines its bootstrap scripts, and nonces would force dynamic rendering of otherwise static pages. Inline styles are allowed for the same framework reasons.
