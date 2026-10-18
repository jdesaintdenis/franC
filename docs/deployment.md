# Deploy on Vercel + Neon

This is how franC runs in production: **Vercel (Hobby) + Neon Postgres (EU)**, both on free
tiers. It takes about 15 minutes. You need your own copy (fork) of the repository. To run franC
on your computer or another server instead, see [`self-hosting.md`](self-hosting.md).

## 1. Neon: two databases

1. Sign up at [neon.tech](https://neon.tech) and create a project in **EU (Frankfurt, `eu-central-1`)**.
2. Create two databases in it: `franc` (Production) and `franc_preview` (Preview).
3. For each, copy the **pooled** connection string (the host ends in `-pooler`). Serverless
   functions open one connection per call, and the pooler keeps Postgres from running out.

> **Keep Preview apart from Production.** Never point Preview at the production database.
> Do not use Neon's "schema only" branches for Preview: they skip `drizzle.__drizzle_migrations`,
> so the build replays every migration and fails with "type … already exists". If you installed
> Neon's Vercel integration, turn off its per-preview branches, which copy production data.

## 2. Vercel: the project

1. Sign up at [vercel.com](https://vercel.com), then Add New > Project, and import your fork.
2. Leave the settings alone: the framework is detected, and `vercel.json` already pins functions to
   `fra1` (Frankfurt, next to Neon) and declares the daily cron. The `vercel-build` script runs
   `pnpm db:migrate && pnpm build`, so every deploy applies the migrations first. That includes
   Preview deploys, which migrate `franc_preview`.
3. Add the environment variables below before the first deploy.

## 3. Environment variables

Never paste a secret anywhere except Vercel's environment variable form.

| Variable | Environments | Value |
| --- | --- | --- |
| `DATABASE_URL` | Production, Preview (different values) | Pooled URL of `franc` / `franc_preview` |
| `BETTER_AUTH_SECRET` | Production, Preview (different values) | `openssl rand -base64 32`. Preview needs its own, or its pages fail with "You are using the default secret" |
| `BETTER_AUTH_URL` | Production, only with a custom domain | `https://franc.example.com`. Leave it unset on Preview. Without a custom domain, Vercel production falls back to its own domain |
| `ALLOWED_EMAILS` | Production, Preview | Your email, comma-separated if several. Only these can sign up |
| `CRON_SECRET` | Production | `openssl rand -hex 24`. Without it the cron route is a 404 and nothing runs |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Production (optional) | See [push reminders](#push-reminders-optional) |
| `ENABLE_BANKING_APP_ID`, `ENABLE_BANKING_PRIVATE_KEY`, `BANK_SYNC_EMAILS` | Optional | See [bank sync](#bank-sync-with-enable-banking-optional) |
| `BACKUP_AGE_RECIPIENT`, `BLOB_READ_WRITE_TOKEN` | Production only (optional) | See [backups](#backups-optional) |

Do not set `DATABASE_URL_TEST` or `E2E_USER_*` on Vercel: tests do not run there. Vercel sets `VERCEL_ENV`, `VERCEL_PROJECT_PRODUCTION_URL` and `VERCEL_GIT_COMMIT_SHA` itself, and `ENABLE_BANKING_API_ORIGIN` only exists so tests can use a fake bank. Every variable, with a comment, is in [`.env.example`](../.env.example).

## 4. First deploy and sign-up

Deploy. Then open `https://<your-app>.vercel.app/signup` and create your account with an email
from `ALLOWED_EMAILS`.

## 5. Daily cron

`vercel.json` runs `/api/cron/daily` at 07:00 UTC (about 9:00 in Paris). It does, in order: the
backup, the bank sync, the push reminders. Hobby plans allow one run a day, which is all it needs.
Vercel sends `Authorization: Bearer $CRON_SECRET` by itself. The route answers 404 when
`CRON_SECRET` is unset and 401 on a wrong token. Run it by hand from Vercel > Settings > Cron
Jobs > Run. It needs `CRON_SECRET` even if you use none of the optional features.

## Push reminders (optional)

The reminder banner in the app needs no setup. The optional push notification (Settings > Import
reminder > "Also send a notification") needs four variables; without them the option stays hidden.

1. Generate VAPID keys: `pnpm exec web-push generate-vapid-keys`.
2. In Vercel add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` or
   `https:` contact, for example `mailto:you@example.com`). Keep the same pair once devices have
   subscribed: changing it cancels their subscriptions.
3. Without the VAPID variables only the pushes are skipped; the rest of the cron still runs.

On iPhone, notifications only work once franC is added to the Home Screen.

## Bank sync with Enable Banking (optional)

Accounts > Bank sync only appears when these variables are set. franC talks to
[Enable Banking](https://enablebanking.com), whose free "restricted production" mode reads the
accounts you link yourself. The steps follow Enable Banking's official samples
(github.com/enablebanking/enablebanking-api-samples); screen names may differ slightly.

1. Create an account on enablebanking.com ("Get started").
2. In the control panel, **Applications** (`/cp/applications`), register two applications:
   - **Sandbox**: fake banks, including "Mock ASPSP", whose accounts and transactions you fill in
     from the control panel. Redirect URLs: `http://localhost:3000/api/bank-sync/callback` and
     each preview address followed by `/api/bank-sync/callback`.
   - **Production**: your real bank. Redirect URL: your production address followed by
     `/api/bank-sync/callback` (https).

   Letting the browser generate the key downloads `<application id>.pem`. Keep it private: it is
   the API key. Never commit it or paste it anywhere but the environment variables.
3. For the production application, link your own bank accounts in the control panel (that is what
   activates the free restricted mode).
4. In Vercel, add per environment (sandbox application for **Preview** and **Development**,
   production application for **Production**):
   - `ENABLE_BANKING_APP_ID`: the application id.
   - `BANK_SYNC_EMAILS`: your own email (comma-separated if several). Only these users see bank
     sync; anyone else allowed to sign up never does. Unset means nobody.
   - `ENABLE_BANKING_PRIVATE_KEY`: the content of the .pem file. Multi-line values work in
     Vercel; where a variable box does not take them, use base64 of the file
     (`base64 -w0 <id>.pem`) or the PEM with `\n` in place of line breaks.

   The callback address is the one you start from (`<that address>/api/bank-sync/callback`), so
   each address you use (localhost, a preview, production) must be in the application's redirect URLs.
5. Redeploy, then Accounts > Bank sync > Manage > Connect.
6. In **Link your accounts**, set **Bring transactions from** for each account: by default the day
   after its newest transaction, so the first **Sync now** continues where your last CSV stopped
   (90 days back at most). Then use **Sync now** on the card or on the Import page.

Enable Banking's free mode only reads accounts you link yourself, so this is for your own accounts, and your bank must be one Enable Banking supports (the Connect screen lists them). Without the three variables the feature stays hidden and CSV import still works.

The consent lasts up to 180 days; you log in at the bank again after that. Sync now passes your IP
address and browser to the bank (Enable Banking's `Psu-Ip-Address` / `Psu-User-Agent`), which marks
it as made with you present, so the bank should not count it against its 4 unattended fetches a day.

## Backups (optional)

The 07:00 cron writes an age-encrypted backup to a **private Vercel Blob store**. Production needs
`BACKUP_AGE_RECIPIENT` (your age public key) and `BLOB_READ_WRITE_TOKEN` (set when you connect the
store, for Production only). Keep the matching private key somewhere safe: without it no backup can
be opened. Setup and the restore runbook are in [`backups.md`](backups.md).

## Install on your phone

Open the deployed address on your phone and use "Add to Home Screen". It opens without browser bars.

## Updating and notes

- Every merge into your fork's `main` redeploys and migrates by itself. Other branches get a Preview
  deploy.
- To run a migration against production outside a deploy, run `pnpm db:migrate` locally with
  `DATABASE_URL` set to the Neon URL in your shell for that one command. Do not put production
  credentials in `.env.local`.
- After deploying a new service worker, open the app online once (on the phone too) so it activates
  and clears old page caches.
