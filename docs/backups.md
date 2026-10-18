# Database backups

## Why

Neon's free tier only keeps a 6-hour restore window and no snapshots, and a copy inside the same
Neon account does not survive losing the account. A nightly, encrypted logical backup in another
place gives a longer-lived second copy that we control.

## Layers

1. **Neon point-in-time restore / branches** (first line): restore or branch from the last 6 hours
   in the Neon console.
2. **Nightly encrypted backup** (second line): the daily cron (`/api/cron/daily`, 07:00 UTC) runs
   first of all, before the bank sync. It copies every table of the `public` schema in one
   read-only snapshot, gzips the result, encrypts it with [age](https://age-encryption.org) to
   `BACKUP_AGE_RECIPIENT` and uploads it to a **private Vercel Blob store** as
   `backups/franc-<UTC stamp>.json.gz.age` (about 70 KB). The 30 newest are kept, older ones are
   deleted after a successful upload. Only the age private key can read them.

## Safety

- The dump runs in a `REPEATABLE READ READ ONLY` transaction: Postgres rejects any write in it, so
  a backup can never change production data. Production uses `DATABASE_URL`, or
  `BACKUP_DATABASE_URL` when set (a read-only role on the direct host).
- The only write is one row in `backup_status` (the result of the last run).
- `pnpm db:restore` refuses any target that has a row in any table, checks that before running
  migrations, and never reads `DATABASE_URL`. The production database is never empty, so it can
  never be a restore target.
- Logs hold counts, sizes and step names only. Never a label, amount, URL or token.
- A failed night: the cron answers 500 (shown as failed in Vercel), and Home shows "Backup failing
  since <date>" to the deployment owner (`BANK_SYNC_EMAILS`) until a night succeeds.

## One-time setup (Vercel)

1. Generate a key pair on your machine, offline: `age-keygen -o key.txt`. Keep `key.txt` (the private
   key) out of the repo, in a password manager. Without it no backup can be opened. The printed
   `age1...` public key is the recipient.
2. Vercel project → Storage → create a **private** Blob store (Frankfurt) and connect it to the
   project for **Production only**. This sets `BLOB_READ_WRITE_TOKEN`.
3. Project → Environment Variables, Production: `BACKUP_AGE_RECIPIENT` (the `age1...` key) and
   `CRON_SECRET` (random; Vercel Cron sends it by itself).
4. Optional: `BACKUP_DATABASE_URL`, a read-only role (`GRANT pg_read_all_data`) on the direct
   (non `-pooler`) host.
5. After the next deploy, wait for 07:00 and check Storage → the store lists a new backup. Without
   `BACKUP_AGE_RECIPIENT` or `BLOB_READ_WRITE_TOKEN` the cron simply skips the backup.

Not on Vercel? `pnpm db:backup` writes the same encrypted file to `./backups` (or
`BACKUP_OUTPUT_DIR`) from `BACKUP_DATABASE_URL` and `BACKUP_AGE_RECIPIENT`. Run it from any cron and
copy the file wherever you like (it does not delete old files). Only `src/lib/backup/blob.ts` is
Vercel-specific.

## Restore runbook

1. Download the `.json.gz.age` file (Vercel → Storage → the store, or `pnpm db:backup`).
2. Create a **new, empty** database, for example `createdb franc_restore`, or a Neon branch with no
   data.
3. Restore:
   `RESTORE_DATABASE_URL=postgres://.../franc_restore BACKUP_AGE_IDENTITY_FILE=path/to/key.txt pnpm db:restore franc-<stamp>.json.gz.age`
   It runs the migrations on the empty database, loads every table in one transaction, checks each
   row count, then re-adds the foreign keys. It prints the row count per table.
4. Sanity-check (`transactions`, `imports`, `categories`, `users`) and open the app against it.
5. To go back to it for real, point `DATABASE_URL` in Vercel at the restored database.
6. Delete the downloaded file when done.

The file is standard age: `age -d -i key.txt -o franc.json.gz franc-<stamp>.json.gz.age` also
opens it, and `gunzip` shows the JSON (`format: "franc-backup"`, one entry per table in Postgres
COPY text).

## Test a restore quarterly

An untested backup is not a backup. Once a quarter, run the restore runbook into a scratch database
and compare row counts.

## Code

`src/db/backup.ts` (dump and restore), `src/lib/backup/` (format, encryption, daily run, Blob),
`src/db/queries/backup-status.ts`, `scripts/db-backup.ts`, `scripts/db-restore.ts`. Tests:
`src/db/backup.test.ts` (full round trip on the test database, refusals, read-only proof),
`src/lib/backup/*.test.ts`, `src/db/queries/backup-status.test.ts`.
