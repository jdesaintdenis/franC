# CLAUDE.md — franC

Personal budget PWA. Upload bank CSV → dedup insert, categorize, detect recurring payments, forecast next month.
Spec: `SPEC.md` (decisions + reasons). Slices/progress: `SLICES.md`. Current behavior: `docs/features/` (index `README.md`). Look: `DESIGN.md` (50 F system; read before any UI work).

## Stack

TypeScript strict · Next.js App Router · Tailwind + shadcn/ui · Recharts · PostgreSQL · Drizzle · Papa Parse · Zod · Serwist · Better Auth · Vitest + Playwright · pnpm

## Commands

```bash
pnpm setup          # one-shot env setup (DB up, install, migrate, seed)
pnpm dev            # dev server
pnpm build          # production build
pnpm lint           # eslint
pnpm typecheck      # next typegen && tsc --noEmit
pnpm test           # vitest
pnpm test:e2e       # playwright vs production build, 4 workers, dot reporter (docs/testing.md)
pnpm test:e2e:dev   # playwright vs `next dev`, quick iteration on a spec
pnpm lighthouse     # build + Lighthouse CI on public pages (set CHROME_PATH if needed)
pnpm db:backup      # encrypted backup file (needs BACKUP_DATABASE_URL, BACKUP_AGE_RECIPIENT)
pnpm db:restore <file>  # restore into a new EMPTY database (RESTORE_DATABASE_URL, BACKUP_AGE_IDENTITY_FILE)
pnpm sample:generate  # rewrite docs/samples/sample-export.csv (synthetic, seeded)
pnpm media:generate   # README screenshots + GIF into docs/screenshots/ (needs ffmpeg)
pnpm db:up / db:down / db:reset   # Postgres via Docker Compose; reset = drop, recreate, migrate, seed
pnpm db:generate    # Drizzle migration from schema changes
pnpm db:migrate     # apply migrations
pnpm db:studio      # Drizzle Studio
```

Update this section when scripts change. Before calling a task done: `pnpm typecheck && pnpm lint && pnpm test`, and update `docs/features/` if behavior changed.

## Structure

`src/app/` routes · `src/components/` UI (shadcn in `ui/`) · `src/db/{schema.ts,migrations/,queries/}` · `src/lib/{import,categorize,recurring}/`, `money.ts` · `scripts/setup.sh` (idempotent, local + cloud) · `docker-compose.yml` (Postgres dev + test DBs; `app` service behind a profile) · `Dockerfile` (dev + prod) · `.claude/settings.json` (SessionStart hook) · `docs/` (`features/`, `samples/` synthetic CSV only, `cloud-setup.md`, `self-hosting.md`, `deployment.md`) · `SPEC.md` `SLICES.md` `LICENSE` (MIT) `SECURITY.md`

Business logic (import, dedupe, categorization, recurring) = **pure functions** in `src/lib/**`. Route handlers and server actions stay thin and call `lib`.

## Conventions

### Environment
- Fresh clone must work with `pnpm setup && pnpm dev`, locally and in a Claude Code cloud session.
- Postgres in Docker Compose; app runs on host by default.
- All config from env vars; `.env.example` is the source of truth. Never hardcode hosts, ports, credentials.
- `scripts/setup.sh`: idempotent, no interactive input.
- Docker missing or slow in a cloud session → use any Postgres reachable via `DATABASE_URL`. Say so; don't burn tokens working around Docker.
- Tests use a separate `db-test` database, never the dev one.
- Pin tool versions (Node in `.nvmrc`, pnpm via `packageManager`). Don't upgrade without saying so.

### Money
- Integer cents only, never floats. Negative = outflow, positive = inflow. EUR.
- Format only at the UI edge via `lib/money.ts`.

### Dates
- Transaction dates are SQL `date` (no time zone). Never convert through `Date` in ways that can shift the day.

### Database
- Schema changes only via Drizzle migrations. Never hand-edit the DB or an applied migration.
- Every user-data query **must be scoped by `user_id`**.
- Duplicates blocked by DB unique constraint `(account_id, dedupe_hash, occurrence_index)` plus app logic.
- Multi-row writes (e.g. import) run in a **single transaction**.

### CSV import
- One bank format only; `docs/samples/` is the source of truth. No generic multi-bank or encoding detection unless asked.
- Parser isolated in `src/lib/import/` behind a small interface.
- Validate every row with Zod. Report invalid rows; never drop silently.
- Flow: upload → preview → confirm. Re-import of same file is idempotent.

### i18n
- English (default) + French via `next-intl`, no locale URLs. Locale resolved per request in `src/i18n/request.ts`: `users.locale`, then `locale` cookie, then `Accept-Language`.
- Messages in `messages/{en,fr}/<namespace>.json` (`common`, `auth`, `dashboard`, `import`, `transactions`, `recurring`, `settings`). French follows `messages/GLOSSARY.md`.
- Add every key in both languages with the same ICU args (`src/i18n/messages.test.ts` enforces). ICU plurals for counts.
- Server: `getTranslations`/`getLocale` from `next-intl/server`. Client: `useTranslations`/`useLocale`.
- `src/lib` returns codes + params, never UI text; translate at the UI edge.
- Money/dates only via locale-aware helpers (`lib/money.ts`, `lib/format-date.ts`, `lib/dashboard/month.ts`), which take the `Locale`.

### Code style
- No `any` (use `unknown` + narrowing).
- Prefer server components and actions; client components only for interactivity.
- Zod-validate all external input (forms, uploads, query params).
- Small focused files/functions, descriptive names, comments explain *why*.
- shadcn/ui + Tailwind; no custom CSS files unless necessary.
- Mobile-first.

### Security and privacy
- Never log transaction data, labels, amounts.
- Never commit secrets (`.env.local` is git-ignored; keep `.env.example` current).
- Never commit real bank exports; only the synthetic sample in `docs/samples/`. Other `*.csv` are git-ignored.
- Everything except login needs auth. Protected pages live in `src/app/(app)/` (layout calls `requireUser()` from `src/lib/auth/session.ts`); server actions and route handlers must call it too. `src/proxy.ts` is only an optimistic cookie check.
- Better Auth tables: `users`, `sessions`, `auth_accounts`, `verifications`. `accounts` = bank accounts.

## Documentation

- `docs/features/` documents every feature: what the user sees, how it works (rules, thresholds, triggers, edge cases), code location, tests. Index and page template in `README.md`.
- Add, change or remove a feature → update its page in the same change (or add a page + index entry). Includes new settings, thresholds, precedence, renamed files, migrations, tests worth pointing to.
- Superseded spec decision → update `SPEC.md` and `docs/features/`.
- Operational changes (setup, deploy, backups, env vars) → matching `docs/` page and `.env.example`.

## Testing

- Unit tests for: CSV row parsing, dedupe hashing + occurrence indexing, idempotent re-import, category rule matching, recurring detection, next-month forecast. Fixtures from the synthetic sample CSV.
- Playwright for main flows. Specs import `test`/`expect` from `e2e/fixtures.ts` (per-worker fresh signed-in user; `docs/testing.md`).
- Before calling work done, run the **whole** E2E suite. Report counts ("117 passed, 0 failed") and name every failing test, even if it also fails on main. The `E2E` CI job runs it on every PR.
- Keep E2E output small: dot reporter is the default; read only the failure summary and totals, never paste or re-read full logs.
- Fix the code, not the test, unless the test is wrong; say so if you change an expectation.
- To inspect or click through a running page, use caveman-browse MCP tools (`browser_snapshot`, `browser_act`, `browser_eval`) when available. Playwright only for E2E specs and screenshots.

## Workflow

1. One slice at a time: next unchecked in `SLICES.md` unless told otherwise.
2. Non-trivial slice: Opus writes a fully detailed plan (files, steps, schema changes, tests, DB/env setup, no judgment calls left) to `/mnt/project-files/plans/` and waits for go. After go, the thread switches to Sonnet (`switch_model`), which does everything else: code (Sonnet subagents if useful), DB setup, full E2E, PR, CI fixes.
3. Read only the `SPEC.md` and `SLICES.md` sections the slice touches, not whole files. Send code searches ("where is X", "what calls Y") to the `caveman:cavecrew-investigator` agent.
4. Small commits at logical points, Conventional Commits (`feat(import): add preview step`).
5. Slice done = typecheck, lint, tests pass, `docs/features/` updated. Tick its box in `SLICES.md`, say what changed.
6. Ambiguous spec or real trade-offs → ask. Record resolved decisions in `SPEC.md`.
7. No new dependencies without saying why; prefer the existing stack.
8. PR green and result reported → stop. Unsubscribe from PR activity after merge; don't keep re-checking or re-reading the thread.

## Out of scope (unless asked)

Envelope budgeting; bank API connections other than the Enable Banking sync (Slices 45–49); multi-user/sharing; multi-currency; multi-bank import formats.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
