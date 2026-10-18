# Claude Code cloud environment setup

Notes for configuring a Claude Code cloud session (claude.ai/code) for this repo.

## Setup script

On session start, `.claude/settings.json` runs `scripts/setup.sh` automatically when
`CLAUDE_CODE_REMOTE=true` (set by the cloud environment). It never fails the
session — errors are logged to `/tmp/franc-setup.log` and the hook exits 0.

If you're configuring the cloud environment's own "setup script" field (run once
when the container image is built, before any session starts), paste:

```bash
corepack enable
pnpm install --frozen-lockfile
docker compose pull db 2>/dev/null || true   # pre-pull the Postgres image so `pnpm setup` doesn't wait on it later
```

## Required environment variables

None are required to build; `pnpm setup` copies `.env.example` to `.env.local` with
working defaults for the Dockerized Postgres. If the cloud environment provides its
own managed Postgres instead of Docker, set:

- `DATABASE_URL` — dev database connection string
- `DATABASE_URL_TEST` — test database connection string (must be a different database)

`pnpm setup` also generates a `BETTER_AUTH_SECRET` in `.env.local` if one isn't
already there (see `scripts/setup.sh`). `ALLOWED_EMAILS`, `E2E_USER_EMAIL` and
`E2E_USER_PASSWORD` come from `.env.example`'s defaults, which are enough to
sign up and run the E2E suite in a cloud session; override `ALLOWED_EMAILS` in
`.env.local` to add your own email.

## Network access

Needs outbound access to:
- `registry.npmjs.org` (pnpm install)
- Docker Hub / registry (`docker compose pull`), if Docker is available in the session

No other external network access is required to build and test. Bank sync calls
`api.enablebanking.com` only when `ENABLE_BANKING_*` are set; the tests use a local fake
server instead, so a session needs that host (and `enablebanking.com` for the sandbox bank
pages) only to try a real sandbox connection.

## Docker availability

Docker may be unavailable or slow to start in a cloud session. `scripts/setup.sh`
detects this and falls back to whatever `DATABASE_URL` in `.env.local` points to.
If neither Docker nor an external Postgres is available, `pnpm setup` prints what
failed and exits non-zero — connect a reachable `DATABASE_URL` and re-run it.
