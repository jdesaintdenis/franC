# Import reminder

A CSV import is only as fresh as its last upload, so every number from a CSV-fed account is only as fresh as your last import. Accounts fed by a [bank connection](bank-sync.md) are left out: they sync by themselves. The import reminder makes sure you never look at stale numbers without knowing it.

## Using it

- **A row in Home's "Needs attention" list** (second, after a balance already below its alert level) when an account has had no new data for more than the number of days you chose (default **14**):
  - one account: "No new data since 12 Sept (18 days)";
  - one stale account among several: "No new data for Savings since …", opening Import with that account preselected (`/import?account=<id>`);
  - several: "2 accounts have no new data for over 14 days", opening Import.
  - It can't be dismissed. It goes away when you import, change the setting, or turn the reminder off for that account.
- **"Data up to …"** line as the small caption above Home's title (the newest transaction date in scope, "today" when it's today). With several accounts and no filter, accounts lagging behind are named: "Data up to 28/09/2026 (Savings: 02/08/2026)".
- **"Based on data up to …"** in the "What's left" card of the Next month page (`/budget/next-month`).
- **Accounts > Imports**: "Remind me to import" and "After [N] days without new data" (1–365), saved on change.
- **Accounts**: a **Remind me to import** checkbox per account (on by default, shown with several accounts), for accounts you only import now and then.
- **Optional notification** (Accounts > Imports > **Also send a notification**), per device, off by default. It only shows when the server has push configured and the browser supports it; on iPhone franC must be added to the Home Screen first. **Turn off on this device** removes it.

## How it works

- **Only accounts without a bank link** are watched: an account fed by a link to a connection that reached the bank (even an expired one; Home asks to reconnect instead) never counts as stale. Home's row, the "Data up to" caption, the Next month caption and the push all follow (`getAccountFreshness(db, userId, { withoutBankLink: true })`). The accounts page still lists every account's checkbox. Users without bank sync see no change.

### Staleness (pure, `findStaleAccounts`)

- **Fresh date** per account = the later of its **latest transaction** and the **Paris date of its latest import**. Importing a file with nothing new still counts as up to date.
- **Stale** when today (Europe/Paris) − fresh date **>** the threshold: with 14 days, data up to the 16th is fine on the 30th, the 15th is stale.
- Skipped: accounts never imported, accounts with the reminder off, and everything when the reminder is off (`users.import_reminder_days` null).
- Sorted oldest first. The banner always covers all accounts, whatever the account filter.
- Other features already cope with import gaps: the balance card and Safe to spend say "Balance on …", and missed-charge detection uses each account's latest transaction, not today ([Recurring](recurring.md)).

### Push notification

- Browser side: `PushManager.subscribe` with the server's VAPID public key (passed as a prop, not a public env var); the subscription is saved by a server action in `push_subscriptions` (one row per device, endpoint unique, deleted with the user).
- Server side: a daily job, `GET /api/cron/daily` (Vercel Cron at 07:00 UTC, about 9:00 in Paris), which runs the [bank sync](bank-sync.md) first, then this push, then the bank health push. It needs `Authorization: Bearer $CRON_SECRET` (constant-time compare); 404 when `CRON_SECRET` is unset, 401 on a wrong token. Without VAPID keys the pushes are skipped (the response says `push-not-configured`) but the bank sync still runs. `src/proxy.ts` lets `/api/cron/*` through without a session cookie.
- A user gets one when the reminder is on, a device is subscribed, at least one account is stale, and none was sent in the last **7 days** (`users.import_reminder_notified_on`). So: once when data goes stale, then weekly while it stays stale.
- The text is generic and localized (saved language, else English): "Time to import" / "Your bank data is 18 days old…". **No account names, amounts or labels** are sent. Tapping it opens `/import`, focusing an open franC window if there is one.
- Subscriptions the push service rejects with 404/410 are deleted. The job logs counts only.
- The service worker handles `push` and `notificationclick` and caches nothing new.
- Env vars (all optional): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`. `pnpm setup` generates local values. See `docs/deployment.md`.

## Hand rows (Slice 56)

Rows added by hand live in a hidden franC import. The reminder skips it (`kind <> 'franc'`) and leaves hand rows out of an account's latest transaction date, so adding a lunch neither counts as a fresh import nor hides a stale one. An account that holds only hand rows has no import to remind about.

## Code

- `src/lib/import-reminder/staleness.ts` (`findStaleAccounts`, `freshDate`, `dataUpTo`, `laggingAccounts`), `notify.ts` (`shouldNotify`)
- `src/db/queries/import-reminder.ts` (`getAccountFreshness`, settings), `src/db/queries/push.ts`
- `src/lib/push/` — VAPID config, cron auth, payload, `runImportReminders`, web-push sender
- `src/app/(app)/import-reminder-banner.tsx`, `data-up-to.tsx`, `coming-up.tsx`, `budget/next-month/outlook-card.tsx`
- `src/app/(app)/settings/import-reminder-settings.tsx`, `import-reminder-actions.ts`, `push-toggle.tsx`, `push-actions.ts`; the account checkbox in `accounts/`
- `src/app/api/cron/daily/route.ts`, `src/app/sw.ts`, `vercel.json`
- Migration `0022_import_reminder`

## Tests

`src/lib/import-reminder/*.test.ts`, `src/lib/push/*.test.ts`, `src/db/queries/import-reminder.test.ts`, `src/db/queries/push.test.ts`; `e2e/bank-daily-sync.spec.ts` (an account a bank feeds is ignored), `e2e/import-reminder.spec.ts` (banner, Import preselect, threshold, per-account opt-out, "Data up to", axe). Push delivery itself isn't E2E-tested: headless Chromium has no push service.

## Related

[CSV import](csv-import.md) · [Dashboard](dashboard.md) · [Recurring](recurring.md) · [PWA and offline](pwa-offline.md) · [Bank accounts and balance](accounts-and-balance.md) · `SPEC.md` §48
