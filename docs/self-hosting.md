# Run franC yourself

Install franC on your computer, or on your own server. To deploy on Vercel + Neon like the
original setup, see [`deployment.md`](deployment.md).

## What you need

- **Git**.
- **Node**, the version in `.nvmrc`. Install it with [nvm](https://github.com/nvm-sh/nvm)
  (macOS, Linux) or [nvm-windows](https://github.com/coreybutler/nvm-windows).
- **pnpm**, the version pinned in `package.json`. Run `corepack enable` once; it comes with Node.
- **Postgres 16**: either [Docker Desktop](https://www.docker.com/products/docker-desktop/)
  (franC starts Postgres for you) or any Postgres you can reach.
- On Windows, run the commands in Git Bash or WSL: `pnpm setup` is a bash script.

## Run it locally

```bash
git clone https://github.com/jdesaintdenis/franC.git
cd franC
pnpm setup   # env file, secrets, database, migrations
pnpm dev     # http://localhost:3000
```

### What `pnpm setup` does

It runs `scripts/setup.sh`, in this order. It is safe to run again.

1. Checks that `node` and `pnpm` exist.
2. Copies `.env.example` to `.env.local` (git-ignored), once.
3. Generates `BETTER_AUTH_SECRET`, the push-notification keys (`VAPID_*`) and `CRON_SECRET`,
   only the ones that are missing.
4. Installs the dependencies.
5. Starts Postgres with Docker Compose if Docker runs. Otherwise it uses `DATABASE_URL` as it is.
6. Applies the migrations to the dev and the test database.

### Without Docker

Create two empty databases on any Postgres, then point franC at them:

```bash
createdb franc_dev
createdb franc_test
cp .env.example .env.local
# edit .env.local: DATABASE_URL=postgres://<user>:<password>@<host>:5432/franc_dev
#                  DATABASE_URL_TEST=postgres://<user>:<password>@<host>:5432/franc_test
pnpm setup
```

## First login

1. Open `http://localhost:3000/signup`.
2. Sign up with an email listed in `ALLOWED_EMAILS` in `.env.local` (the default list includes
   `owner@example.com`). Any other email is refused. The list is comma-separated and case-insensitive.
3. A new account starts with no categories. Import the synthetic sample to look around:
   Accounts > Import CSV > choose `docs/samples/sample-export.csv` (140 rows, July to September 2025,
   invented merchants) > **Create all** bank categories > confirm. Importing it again adds nothing.

Any bank's CSV works: on the first import you match the columns, and franC remembers. The sample file is one example.

## Optional features

- **Push reminders**: need the `VAPID_*` keys and `CRON_SECRET`. See [`deployment.md`](deployment.md#push-reminders-optional).
- **Bank sync** through Enable Banking: see [`deployment.md`](deployment.md#bank-sync-with-enable-banking-optional).
- **Backups**: see [`backups.md`](backups.md).

## Everything in Docker

By default only Postgres runs in Docker and the app runs on your machine. This is on purpose:
native hot reload is faster than through a Docker volume (especially on macOS and Windows), the
debugger attaches directly, and packages with native builds are not built for the wrong
architecture. If you prefer the app in a container too:

```bash
docker compose --profile app up   # app + database, same Dockerfile as production
```

## Run it on your own server (without Vercel)

1. Build the image: `docker build --target production -t franc .`
2. Create an empty Postgres database and apply the migrations **from a checkout**, now and after
   each upgrade (the image has no migration tool):
   `DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>' pnpm db:migrate`
3. Put your settings in a file, for example `prod.env`:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | your Postgres URL |
   | `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
   | `BETTER_AUTH_URL` | `https://franc.example.com` |
   | `ALLOWED_EMAILS` | `you@example.com` |

   The optional variables are described in `.env.example` and [`deployment.md`](deployment.md).
4. Run it: `docker run -p 3000:3000 --env-file prod.env franc`
5. Put an HTTPS reverse proxy in front. Sign-in cookies, the service worker and push need HTTPS.
6. Schedule the daily job at 07:00 UTC with any cron (set `CRON_SECRET` in `prod.env` first):
   `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://franc.example.com/api/cron/daily`
7. Backups without Vercel Blob: `pnpm db:backup` writes an encrypted file to a folder. See
   [`backups.md`](backups.md).

## Troubleshooting

- **Port 5432 is busy**: set `POSTGRES_PORT` in `.env.local` and use the same port in
  `DATABASE_URL` and `DATABASE_URL_TEST`.
- **"You are using the default secret"**: `BETTER_AUTH_SECRET` is missing in that environment.
  Run `pnpm setup` locally, or set it in your host's settings.
- **"DATABASE_URL is not set"**: there is no `.env.local`. Run `pnpm setup`.
- **Sign-up is refused**: the email is not in `ALLOWED_EMAILS`.
- **Migrations fail during setup**: Postgres is not reachable. Fix the URL and run `pnpm setup` again.
- **No push notification on iPhone**: add franC to the Home Screen first.
