# franC — Product Spec

## 1. Overview

**franC** is a personal budget manager delivered as a Progressive Web App (PWA). It gives a very straightforward view of where money went, what recurring payments exist, and what to expect next month.

Transactions come from a CSV export of my bank or the automatic bank sync (Slices 45–49, §60). Since Slice 56 (§71) a transaction can also be added by hand, for cash and the Swile meal card.

This spec records goals and **decisions with their reasons**. How each feature behaves today is documented in `docs/features/` (one page per feature). When a decision here changes a feature, update its page in `docs/features/` too.

## 2. Goals

1. See at a glance **how much was spent, on what, and when**.
2. See all **recurring payments** (subscriptions, bills, rent, etc.) in one place.
3. See **what to expect next month** based on detected recurring payments.
4. Import transactions by **uploading a CSV**, with automatic insertion and **no duplicates**, even when uploading overlapping exports.
5. Be installable and pleasant to use on a phone.

## 3. Non-goals (v1)

- Envelope / zero-based budgeting (YNAB-style budget assignment).
- Direct bank connection (Open Banking, aggregators). Superseded on 2026-10-02: automatic sync through Enable Banking is planned (§60).
- Multi-user, sharing, or household features.
- Multi-currency support (EUR only).
- Handling multiple banks' formats. v1 supported **one bank's CSV format**; superseded by the column mapping (§86).
- Investment, debt, or net-worth tracking.

## 4. Users

A single user (the owner). Authentication is still required because the data is financial.

## 5. Core concepts and data model

All money amounts are stored as **integer cents** (never floats). Negative = outflow, positive = inflow.

### Tables (indicative — refine during implementation)

**users**
- id, email, created_at (managed by the auth library)

**accounts**
- id, user_id, name (unique per user, case-insensitive), created_at
- starting_balance_cents (integer, nullable), starting_balance_date (date, nullable): both null or both set; the balance at the start of that date (§38)
- low_balance_threshold_cents (integer, not null, default 0): warn when the projected balance goes below it
- in_safe_to_spend (boolean, not null, default true): whether the account counts in "safe to spend" (§42)

**imports**
- id, user_id, account_id, filename, uploaded_at
- rows_total, rows_inserted, rows_duplicate, rows_error

**transactions**
- id, user_id, account_id, import_id
- date (date), amount_cents (integer), label_raw (text), label_normalized (text)
- category_id (nullable), category_source (`manual` | `rule` | `bank` | `guess`, null with no category), recurring_id (nullable)
- merchant_id (nullable, FK to merchants, `ON DELETE SET NULL`): the merchant name the row carries, a stored result of pattern matching (§39)
- dedupe_hash (text), occurrence_index (integer)
- reviewed_at (timestamptz, nullable, default `now()`): null while the row is "to review". Only `commitImport` inserts null, so older rows and any other insert path start reviewed; a partial index on (user_id, import_id) where null keeps the count cheap
- created_at
- **Unique constraint** on (account_id, dedupe_hash, occurrence_index)

**categories**
- id, user_id, name, color, icon (optional)

**rule_suggestion_dismissals** (Slice 27)
- id, user_id, match_type, pattern, category_id (composite FK to categories, cascade), created_at; unique per user + match type + pattern + category ("Not now" on a suggested rule)

**category_rules**
- id, user_id, category_id, match_type (`contains` | `equals` | `regex`), pattern, priority

**merchants** (Slice 25)
- id, user_id, name (1–60 chars, unique per user ignoring case), created_at

**merchant_patterns** (Slice 25)
- id, user_id, merchant_id (cascade), match_type (`contains` | `starts_with` | `equals`), pattern (≤ 200 chars), created_at

**recurring**
- id, user_id, account_id, merchant_key, typical_amount_cents, interval (`weekly` | `monthly` | `quarterly` | `yearly`)
- last_seen_date, next_expected_date
- status (`detected` | `confirmed` | `dismissed` | `ended`)
- ended_at (date the user marked it ended), still_active_at (account's latest date when the user answered "Still active") (§45)

**transfers** (internal transfers, Slice 16)
- id, user_id, out_transaction_id, in_transaction_id (each unique), status (`detected` | `confirmed`), created_at

**transfer_rejections**
- user_id, out_transaction_id, in_transaction_id (pairs the user unlinked; never suggested again)

**category_budgets** (Slice 17)
- category_id (primary key), user_id, amount_cents (> 0), created_at, updated_at

**transaction_splits** (Slice 18)
- id, user_id, transaction_id, category_id (nullable), amount_cents (<> 0), position, created_at

**savings_goals** (Slice 30)
- id, user_id, name (1–60 chars, unique per user ignoring case), target_cents (> 0, ≤ 10 000 000 EUR), target_date (nullable), icon (nullable emoji)
- account_id (nullable, FK to accounts `ON DELETE SET NULL`): the account its money is kept in (several goals can share one since Slice 55, §70); null = a goal tracked by hand
- start_cents, start_date: saved amount when the plan (re)started, for the on-track line (§44)

**savings_goal_contributions** (Slice 30)
- id, user_id, goal_id (composite FK to savings_goals, cascade), date, amount_cents (<> 0; negative = taken out), created_at
- transaction_id (nullable, composite FK to transactions `ON DELETE CASCADE`, unique when set; Slice 55): the row on the goal's account this entry follows

**recurring_price_alerts** (Slice 19)
- id, user_id, recurring_id, transaction_id (the higher charge), old_amount_cents, new_amount_cents, charged_on, status (`open` | `accepted` | `dismissed`), created_at, resolved_at

## 6. CSV import

### Supported format
The import parser targets **the current export format of my bank**. A sample export lives in `docs/samples/` (synthetic) and is the source of truth for column names, delimiter, date format, and number format. Only that format needs to work in v1. The parser should still be isolated in its own module (`src/lib/import/`) so other formats can be added later.

### Flow
1. **Upload** a `.csv` file and pick the target account.
2. **Parse and validate** every row (Zod). Invalid rows are reported, not silently dropped.
3. **Preview**: show counts, e.g. "120 new, 35 duplicates skipped, 3 errors", plus a sample of new rows and the error rows.
4. **Confirm**: insert new rows in a single DB transaction and record an `imports` row.
5. After insert: apply category rules and re-run recurring detection.
6. Newly inserted rows start "to review" (`reviewed_at` null); duplicates keep their state. Undoing the import removes its rows, and so their place in the review queue.

### Duplicate prevention
- Compute `dedupe_hash` from: account + date + amount_cents + normalized label.
- Within one file and across existing DB rows, count identical hashes and assign an `occurrence_index` (0, 1, 2…) so that two legitimate identical purchases on the same day are both kept, but re-uploading the same file or an overlapping export inserts nothing new.
- Enforced by the DB unique constraint, not only by application logic.
- Re-importing the same file must be **idempotent**.

### Import history
- The user can see past imports (date, filename, counts) and **undo** an import (deletes the transactions created by that import).

## 7. Categorization

- Categories are user-managed. New users start with none; the first import offers to create them from the bank's own categories (see §27).
- **Rules** auto-assign categories on import using label matching, evaluated by priority.
- Transactions can be categorized manually. A manual categorization can optionally create a rule ("always categorize labels containing X as Y").
- Creating or editing a rule can be applied retroactively to existing uncategorized transactions.
- A manual category is never overwritten by a rule.
- **Precedence** (Slice 27): rule > bank category > guess > nothing. A guess only fills rows still uncategorized after rules and bank mappings, and is replaced by either; nothing but the user replaces a manual category (§41).

## 8. Recurring payment detection

- Group transactions by `merchant_key` (a normalized version of the label).
- A group is a recurring candidate when it has at least 3 occurrences at a roughly regular interval (weekly ≈ 7d, monthly ≈ 28–31d, quarterly, yearly) and a stable amount (within a tolerance, e.g. ±10%).
- Each detected item has a status: `detected` → user can `confirm` or `dismiss`. Dismissed items are not re-suggested.
- `next_expected_date` is projected from the last occurrence and the interval.
- Detection re-runs after each import.
- A charge more than the tolerance above an item's usual amount raises a price alert, which the user accepts or dismisses (Slice 19, §32).

## 9. Next-month forecast

- Sum of all confirmed (and detected, but visually distinguished) recurring items whose `next_expected_date` falls in the next calendar month.
- Displayed as a total plus a list (merchant, expected date, expected amount).
- Since Slice 24 the same occurrences also drive a day-by-day 30-day balance projection (§38).

## 10. Screens

1. **Home / Dashboard**
   - Balance card (Slice 24): balance per account, lowest point in the next 30 days, overdraft warnings and a small projection chart, above the month selector (§38).
   - Current month: total spent, total income, net ("Bilan" in French).
   - Spending by category (chart), month-over-month trend.
   - "Coming up": next recurring payments and the next-month expected total.
2. **Transactions**
   - Searchable, filterable list (date range, category, amount, text, uncategorized only).
   - Inline categorization.
3. **Recurring**
   - List of detected and confirmed recurring payments, with interval, amount, next date.
   - Confirm / dismiss actions.
   - Next-month expected total.
4. **Import**
   - Upload → preview → confirm.
   - Import history with undo.
5. **Settings**
   - Accounts, categories, category rules.

## 11. Non-functional requirements

- **PWA**: installable, valid manifest, service worker with an offline app shell, responsive and mobile-first.
- **Security**: authenticated access only; every query scoped by `user_id`; no financial data in logs; secrets via environment variables.
- **Privacy**: the database is hosted in the EU. Sample CSVs committed to the repo must be synthetic. Real exports are git-ignored.
- **Performance**: import of a few thousand rows completes in seconds; dashboard queries use aggregate SQL, not client-side loops.
- **Correctness**: import, dedupe, and recurring detection are covered by unit tests.

## 12. Development environment

- The whole environment is reproducible from a fresh clone with `pnpm setup && pnpm dev`, on a local machine or in a Claude Code cloud session.
- **Docker Compose** provides PostgreSQL 16 (dev and test databases). A multi-stage **Dockerfile** provides a dev image and a production image reused for deployment.
- The app runs on the host by default; a Compose profile runs it fully in Docker.
- Configuration is via environment variables (`.env.example` documents them).
- If Docker isn't usable (some cloud sessions), the setup falls back to any Postgres given by `DATABASE_URL`.
- Details for the cloud environment (setup script, network access) live in `docs/cloud-setup.md`.

## 13. Tech stack

TypeScript, Next.js (App Router), Tailwind + shadcn/ui, Recharts, PostgreSQL, Drizzle ORM, Papa Parse, Zod, Serwist (PWA), Better Auth (or Auth.js), Vitest, Playwright. See `CLAUDE.md` for conventions.

## 14. Resolved decisions (Slice 2)

- **Auth**: Better Auth, email + password only. Sign-up is restricted to the emails in `ALLOWED_EMAILS` (comma-separated, case-insensitive; empty ⇒ nobody). Everything except `/login`, `/signup`, auth endpoints and PWA assets requires a session: `src/proxy.ts` does an optimistic cookie check, `requireUser()` in the `(app)` layout is the authoritative one.
- **Table names**: Better Auth's own models are mapped to `users`, `sessions`, `auth_accounts` (login methods) and `verifications`, so that `accounts` keeps meaning bank accounts as in §5.
- **IDs**: `users.id` is Better Auth's text id; domain tables use UUIDs and a `user_id` FK with `on delete cascade`.
- **transactions.category_source** (`manual` | `rule`, nullable) records how a category was set, so rules never overwrite manual choices (Slice 7).
- **transactions.import_id** cascades on delete, so undoing an import (Slice 5) removes exactly its transactions.
- **recurring** is unique on `(user_id, merchant_key)` so a dismissed item is never re-suggested. Since Slice 15 the key is `(user_id, account_id, merchant_key)` (§28).

## 15. Resolved decisions (Slice 3)

- **Parser** lives in `src/lib/import/` behind a `CsvFormat` interface (`formats/bank-export.ts`); `prepareImport(text, accountId)` is the entry point. It takes an already-decoded string (decoding is the upload step's job) and strips a leading BOM.
- **Date**: `transactions.date` is the CSV's `Date operation` (when the money was spent), not `Date de comptabilisation` (booking date, validated but not stored).
- **Labels**: `label_raw` is `Libelle operation` (the detailed label). The parser also returns `Libelle simplifie`; Slice 4 adds a display column for it via migration. Display labels can be edited freely later — they never feed the hash.
- **Amount**: exactly one of `Debit`/`Credit` must be set, with a coherent sign; parsed to integer cents with string arithmetic.
- **Dedupe hash**: SHA-256 hex of `JSON.stringify([accountId, date, amountCents, labelNormalized])`. `occurrence_index` numbers identical hashes within a file (0, 1, 2…); a row is a duplicate iff its `(hash, index)` already exists for the account.
- **Label normalization** (NFKD, strip accents, uppercase, collapse whitespace) is frozen once data exists: re-imports recompute hashes with it, so changing it would require a re-hash migration.
- **Errors**: (superseded by §86: no fixed header) a wrong header rejected the file; invalid rows are returned with their file line number and messages, alongside the valid rows.

## 16. Resolved decisions (Slice 4)

- **Stateless preview → confirm**: nothing is staged server-side. The client keeps the `File`; the `previewImport` and `confirmImport` server actions (`src/app/(app)/import/actions.ts`) each re-validate (Zod: account uuid, non-empty `.csv`, ≤ 2 MB), check account ownership, decode and re-parse. Confirm is authoritative and reports its own counts.
- **Encoding** (superseded by §86: UTF-8 first, Windows-1252 fallback): the bank export is **Windows-1252** (the synthetic sample is ASCII, but real labels contain Latin-1 accents such as `é` as single bytes), so uploads are decoded as Windows-1252. It maps every byte, so decoding never fails. No encoding detection: a UTF-8 file would show garbled accents. Label normalization strips accents, so dedupe hashes are unaffected by this choice.
- **Insert**: `commitImport` (`src/db/queries/imports.ts`) runs in one DB transaction: insert the `imports` row, insert all valid rows in chunks of 1000 with `ON CONFLICT (account_id, dedupe_hash, occurrence_index) DO NOTHING`, then store the counts. Duplicates = valid rows − inserted, so the unique constraint is the final judge (race-safe).
- **Empty imports are recorded**: a confirmed import that inserts 0 rows still gets an `imports` row, so history shows every confirmed upload.
- **Display label**: `transactions.label_display` holds `Libelle simplifie` (falling back to `Libelle operation`); never part of the hash.
- **Body size**: `experimental.serverActions.bodySizeLimit` is `4mb` (default 1 MB is too small; Vercel caps requests at 4.5 MB).
- Category rules and recurring detection after import (§6 step 5) land with Slices 7 and 9.

## 17. Resolved decisions (Slice 5)

- **Undo hard-deletes the import**: `undoImport` (`src/db/queries/imports.ts`) deletes the user's `imports` row and the `transactions.import_id` cascade removes its transactions. There is no "undone" state; the entry leaves the history.
- **An import owns only the rows it inserted**: a later overlapping import counts shared rows as duplicates, so undoing it leaves them in place, and undoing the earlier import removes them even though the later file also contained them. Re-importing an undone file restores exactly its rows (their dedupe keys are free again). Gaps in `occurrence_index` after an undo are harmless.
- **History** shows the latest 50 imports, newest first, on the Import page. Upload times display in `Europe/Paris` (pages render on the server, which runs in UTC on Vercel).
- **Confirmation** uses shadcn's AlertDialog (`@radix-ui/react-alert-dialog`), to be reused for later destructive actions.

## 18. Resolved decisions (Slice 6)

- **Infinite scroll, virtualized**: the Transactions page server-renders the first 50 rows; `TransactionList` (client) virtualizes with `@tanstack/react-virtual`'s window virtualizer and fetches further pages through the `loadMoreTransactions` server action as the end nears.
- **Keyset pagination**: rows are ordered `date desc, id desc`; the cursor is `YYYY-MM-DD_uuid` and pages continue with `(date, id) < cursor`, so inserts or undos between fetches never cause gaps or repeats. Queries live in `src/db/queries/transactions.ts`.
- **Filters live in the URL** (`q`, `from`, `to`, `category`, `min`, `max`, `direction`), parsed with Zod by `parseTransactionFilters` (`src/lib/transactions/filters.ts`). Invalid params are dropped rather than rejected, so a bad URL still renders the list; `min`/`max` are swapped when reversed. The filter form is a plain GET form (works without JS), built with native inputs for the best phone pickers.
- **Amount filter** compares the **absolute** amount (euro text in the URL, e.g. `min=12,50`, integer cents internally), combined with a direction toggle: All / Expenses / Income.
- **Search** matches `label_normalized` (with the query run through `normalizeLabel`, so case- and accent-insensitive) or `label_display` via `unaccent(label_display) ILIKE unaccent(query)` (Postgres `unaccent` extension, migration `0003`), so both labels are case- and accent-insensitive in both directions ("Vétérinaire" ⇄ "Veterinaire"). LIKE wildcards in the query match literally.
- **Uncategorized only** is the `category=none` option of the category select rather than a separate checkbox.

## 19. Resolved decisions (Slice 7)

- **Matching**: a rule matches when **either** `label_normalized` or `normalizeLabel(label_display)` matches. `contains`/`equals` compare against `normalizeLabel(pattern)`, so they ignore case and accents; `regex` runs as a JS `RegExp(pattern, "iu")` (also tried against the raw display label). Patterns are capped at 200 characters; regexes are compile-checked on input, and an invalid stored regex never matches. Matching runs in JS (`src/lib/categorize/rules.ts`), not SQL, so regex semantics are the same everywhere.
- **Priority**: rules are evaluated by `priority asc, created_at asc`; the first match wins. New rules go last; reordering rewrites priorities `0..n-1` in one transaction (up/down buttons, no drag-and-drop).
- **Invariant**: `category_source` is null exactly when `category_id` is null. A manual choice sets `manual`; clearing a category clears both, so rules may categorize the row again. Deleting a category uncategorizes its transactions (source cleared too) and deletes its rules, in one transaction.
- **Rules only fill uncategorized rows**: every rule write is guarded by `category_id IS NULL`, so manual categories are never overwritten and rule results are not re-evaluated when rules change.
- **On import**: `commitImport` loads the rules inside its transaction and categorizes each new row at insert time.
- **Retroactive**: creating or editing a rule applies all rules to uncategorized transactions when "Apply to uncategorized transactions" is checked (default); the Rules page also has "Apply rules now". Creating a rule from a transaction ("Always categorize like this") always applies it retroactively.
- **UI**: categories and rules are managed under Settings (`/settings/categories`, `/settings/rules`). On Transactions, tapping a row opens a dialog (shadcn Dialog, `@radix-ui/react-dialog`) to set the category and optionally create a rule; loaded rows are patched in place.

## 20. Resolved decisions (Slice 8)

- **Month**: the dashboard opens on the current calendar month in `Europe/Paris`. `?month=YYYY-MM` selects another month; an invalid value falls back to the current month. Prev/next/"This month" are plain links. When the selected month has no transactions, the empty state links to Import and to the latest month that has data.
- **Totals**: spent = sum of outflows, income = sum of inflows, net = income − spent, all in integer cents. Everything counts across all of the user's accounts, except internal transfers since Slice 16 (§29).
- **Trend**: the selected month and the 5 before it, spent and income bars; months without data are zero-filled. Tapping a bar selects that month.
- **Category chart**: outflows only (`amount_cents < 0`), so a refund never hides spending. Outflows without a category form an "Uncategorized" bucket. The list under the donut is the accessible drill-down path; percentages are display-only, rounded integers.
- **Drill-down** reuses the Transactions URL filters: `/transactions?from=<first day>&to=<last day>&category=<id|none>&direction=out`. No new list UI.
- **Code layout**: aggregations run in SQL in `src/db/queries/dashboard.ts`; month math is pure string arithmetic in `src/lib/dashboard/month.ts` (`Date` is used only to find the current month). No schema change; `transactions_user_id_date_idx` covers the range scans.
- **Dependencies**: `recharts` (v3) for the charts, plus its peer dependency `react-is`.

## 21. Resolved decisions (Slice 9)

- **Merchant key**: `merchantKey(label_normalized)` (`src/lib/recurring/merchant-key.ts`) strips bank noise: channel prefixes (`CB`, `PRLV`, `VIR SEPA`, `VIR.`, `VIR`), the card date suffix `FACT ddmmyy`, a loan `DU dd/mm/yy` suffix, trailing numeric tokens, and folds every `RETRAIT DAB …` into `RETRAIT DAB`. It is built on the frozen hashed label, not the display label, and is always a substring of it, so `/transactions?q=<key>` finds the group.
- **Grouping**: by merchant key **and sign**, so regular income (salary) is detected as well as outflows. The `(user_id, merchant_key)` unique constraint allows one item per key; when both signs qualify, the group with more occurrences wins.
- **Intervals** (gap in days, inclusive): weekly 6–8, monthly 27–33, quarterly 85–97, yearly 355–375. Monthly is wider than §8's 28–31 because bank dates slip over weekends.
- **Qualifying**: the band comes from the latest gap; the algorithm walks back from the latest occurrence while gaps stay in the band and amounts stay within ±10% of the latest amount (integer check). The trailing run needs ≥ 3 occurrences, so an old price change or missed month doesn't block detection. Two occurrences on the same day disqualify the group. `typical_amount_cents` is the (lower) median of the run.
- **Dates**: `next_expected_date` = last occurrence + interval, via pure `YYYY-MM-DD` arithmetic (`src/lib/recurring/dates.ts`); months keep the day and clamp to month end.
- **Staleness**: a candidate whose last occurrence is more than 2 intervals before the user's latest transaction date is dropped (the reference date is data-driven, not "today", so detection stays pure and reproducible).
- **Refresh** (`refreshRecurring`, `src/db/queries/recurring.ts`, one DB transaction): new candidates are inserted as `detected`; existing detected/confirmed items are updated, keeping their status; `detected` items that no longer qualify are deleted; `confirmed` items are kept, with dates refreshed from their merchant group, unless the merchant has no transactions left (e.g. its import was undone), in which case they are deleted too; `dismissed` items are final and never updated or re-suggested. `transactions.recurring_id` links are rebuilt each run. No schema change.
- **When**: after each confirmed import and each undo, in a separate transaction after the commit, so a detection failure never rolls back or fails the import (it logs a fixed message only). The Recurring page also has **Detect now**, for data imported before this slice.
- **UI**: `/recurring` lists Confirmed then Detected items (name = latest linked display label), with interval, typical amount, next and last dates, and a link to the matching transactions. Detected items can be confirmed or dismissed; confirmed items can be dismissed. Dismiss asks for confirmation, since it is permanent.

## 22. Resolved decisions (Slice 10)

- **Projection**: every non-dismissed item is projected from its `last_seen_date` as `last + k·interval` (k ≥ 1), with no clamping drift (a 31st goes to Feb 28/29 and back to Mar 31). Weekly items therefore appear 4–5 times a month. Overdue items still project, and confirmed items that stopped occurring keep projecting until dismissed, as long as some of their transactions remain.
- **Next month**: the calendar month after the current month in `Europe/Paris`, independent of the month selected on the dashboard.
- **Totals**: expected out, expected in and net (integer cents; out and in are non-negative magnitudes, net = in − out, like the dashboard). The headline figure includes detected items; the confirmed-only net is shown separately whenever detected items are included.
- **Coming up** (dashboard): occurrences from today through today + 30 days inclusive, soonest first, at most 5. Past-due occurrences are not listed. The widget shows next month's expected net and links to `/recurring`, and is hidden when the user has no recurring items.
- **Detected vs confirmed**: detected items are distinguished by the "Detected" pill plus dashed border and muted background, never by color alone.
- **Code layout**: pure logic in `src/lib/recurring/forecast.ts` and `occurrencesBetween` in `src/lib/recurring/dates.ts`; the pages reuse `listRecurring`. No SQL or schema change.

## 24. Resolved decisions (Slice 11)

- **Offline policy**: the service worker caches static assets only. Pages, RSC payloads and `/api` are network-only, so financial data is never stored in Cache Storage. `/offline` is precached and served as the navigation fallback, and an offline banner shows when the connection drops. Legacy page caches from earlier service workers are purged on activation.
- **Security headers**: set in `src/lib/security/headers.ts` (CSP, frame, referrer, content-type and permissions headers). The CSP keeps `'unsafe-inline'` for scripts because Next inlines its bootstrap and hydration scripts and a nonce-based CSP would force fully dynamic rendering; `'unsafe-eval'` is dev-only.
- **Log redaction**: `src/instrumentation.ts` redacts DB errors before they reach logs, and server actions are wrapped with `withActionErrors` so failures return a generic message. No transaction data, labels or amounts are logged.
- **Guards**: tests refuse to run against anything but the `db-test` database, `db:reset` refuses production-looking URLs, and `commitImport` verifies that the import belongs to the user.
- **Error, loading and empty states**: `(app)/error.tsx` plus per-route `loading.tsx` skeletons, and explicit empty states with a next action. Optimistic UI is used where it helps: rule reorder and recurring confirm/dismiss update immediately and roll back on failure.
- **Accessibility**: amounts are read via `formatSignedCents` (explicit "expense"/"income" wording rather than sign or color alone), there is a skip link, the spending chart has an sr-only data table, and axe checks run in `e2e/a11y.spec.ts`.
- **Backups**: the daily cron writes an `age`-encrypted backup to a private Vercel Blob store, 30 kept (app code: `COPY` text of every table, gzip, `age`). Neon point-in-time restore is the first line of defence. See `docs/backups.md`.
- **Lighthouse CI**: `pnpm lighthouse` audits the public pages only (`/login`, `/offline`), uploads to the filesystem (never public storage), and asserts accessibility >= 0.95 and best-practices >= 0.9 as errors, performance >= 0.8 as a warning. Lighthouse no longer has a PWA category; see `docs/lighthouse.md`.

## 25. Resolved decisions (Slice 12)

- **Library**: `next-intl`, used without locale routing (no `/fr/` in URLs). The locale is resolved per request in `src/i18n/request.ts`.
- **Resolution order**: the user's saved `users.locale` (`'en' | 'fr'`, null = follow the browser), then the `locale` cookie (set when a language is picked, so the login page follows the choice after sign-out), then the best `Accept-Language` match, then English. The column is a Better Auth `additionalFields` entry, so it comes with the session at no extra query.
- **Picker**: Settings offers Automatic (browser language), Français and English. Language names are always shown in their own language.
- **Formatting**: French formats with `fr-FR` (`1 234,56 €`, `29/09/2026`), English with `en-GB` (`€1,234.56`, `29/09/2026`) so dates stay day-first. Month names come from `Intl`. Display time zone stays Europe/Paris; storage is unchanged (integer cents, SQL `date`).
- **Messages**: `messages/{en,fr}/<namespace>.json`, with French terms fixed in `messages/GLOSSARY.md` ("opération" for transaction, "vous" forms). `src/lib` returns codes (CSV row issues, validation errors), translated at the UI edge. A unit test fails when a key, ICU argument or rich-text tag exists in one language only.
- **Not translated**: category names (the user's own data) and bank category names, which stay in French.
- **Offline and global error pages**: the service worker precaches one copy of `/offline`, so it ships both languages and picks one from `navigator.languages`; `global-error.tsx` renders outside the layout and does the same.
- **Manifest and `<html lang>`** follow the active locale.

## 26. Resolved decisions (Slice 13)

- **Schema**: `categories.parent_id` (nullable) with a composite FK `(parent_id, user_id) → categories(id, user_id)` `ON DELETE RESTRICT`, so a parent always belongs to the same user; `CHECK (parent_id <> id)`. Names are unique per parent: `(user_id, parent_id, name)` `NULLS NOT DISTINCT`, so "Housing > Other" and "Transport > Other" can coexist (needed for bank subcategories in Slice 14). Migration `0005_category_parent`.
- **Two levels**: enforced in the app by pure functions (`src/lib/categorize/hierarchy.ts`), run inside the write transaction with the rows locked. A parent must be top-level and not the category itself; a category with subcategories can't become a subcategory. Transactions and rules can point at a parent or a subcategory.
- **Moving**: a subcategory can move to another parent or become top-level; a top-level category without subcategories can move under a parent. Its transactions and rules follow it.
- **Deleting a subcategory**: move its transactions (keeping `category_source`) and rules to the parent (default), or uncategorize its transactions and delete its rules.
- **Deleting a parent with subcategories**: keep them as top-level categories (default; refused with nothing changed if one's name is already used at top level), or delete them too (their transactions uncategorized, their rules deleted). The parent's own transactions are uncategorized and its rules deleted either way. One DB transaction.
- **Pickers**: native selects in tree order (parents by name, each followed by its subcategories), labelled "Housing > Furniture". Transaction rows and the rule list show the same path.
- **Filter**: `?category=<parent>` includes its subcategories (children resolved in a subquery scoped by `user_id`).
- **Dashboard**: the category chart rolls outflows up to top-level categories in SQL. A parent with subcategory spending links to `/?month=YYYY-MM&category=<parent>`, which shows that parent's subcategories plus a "(no subcategory)" bucket for rows filed on the parent itself; that bucket and "See all transactions" link to the parent's transaction filter (which includes subcategories). Changing month returns to the top-level view.
- **Bulk edit**: a Select mode on Transactions picks loaded rows (kept by id across virtualization; "Select all loaded" caps at 500). `bulkCategorize` sets a category (source `manual`) or clears category and source together, for at most 500 of the user's own transactions, in one DB transaction. Selection never extends to rows not loaded.
- **Provisioning** uses `ON CONFLICT DO NOTHING` without a target, since the per-parent unique can't be named by columns.

## 27. Resolved decisions (Slice 14)

- **No default categories**: `provisionUserDefaults` only creates the default bank account. Existing users keep their seeded categories as regular top-level ones. When a user has no categories, every category picker shows a hint linking to Import and to Settings > Categories (the transactions filter keeps its select, since "Uncategorized" still works).
- **Bank columns**: the parser keeps `Categorie` and `Sous categorie` as `transactions.bank_category` / `bank_subcategory` (migration `0006_bank_categories`). The bank's placeholders count as no category: a category starting with "A categoriser" clears both, a subcategory ending with "a categoriser" clears the subcategory. They never feed the dedupe hash. Bank names are stored and shown as-is, in French.
- **Mappings**: `bank_category_mappings (user_id, bank_category, bank_subcategory, category_id)`, unique per user and pair (`NULLS NOT DISTINCT`; a null subcategory is the bank category itself). A null `category_id` means Ignored. The composite FK to `categories(id, user_id)` cascades, so deleting a category forgets its mappings and the next import asks again.
- **Resolution**: a row gets its subcategory's mapping if mapped, else its bank category's mapping if mapped, else nothing. So ignoring a subcategory falls back to the parent's mapping.
- **Preview**: lists the bank categories and subcategories of the file (all valid rows, duplicates included) that have no mapping yet, each with Create / Map to / Ignore, plus Create all. Nothing is pre-selected except a same-named existing category at the matching place (pre-selected as Map to). Undecided items are not stored and are asked again. A created subcategory goes under its bank category's target (under the target's parent if the target is itself a subcategory, to keep two levels; top-level if the bank category is ignored or undecided). Created categories get colors from a fixed palette. The server re-derives the plan from the file at confirm and never trusts the client's.
- **Confirm**: one DB transaction creates categories (reusing any same-named one at that place), stores mappings, inserts rows, backfills, and applies the mappings to the user's uncategorized rows that have a bank category.
- **Precedence**: rule, then bank, then nothing. `category_source` gains `bank`. Rules replace `bank` categories (at import and retroactively: candidates are `category_id IS NULL OR category_source = 'bank'`); bank mappings only fill rows with no category, so they never replace a rule or manual choice.
- **Backfill**: re-importing a file sets the bank columns on existing rows (same account, hash and occurrence) whose bank columns are both null; nothing else changes and no rows are inserted. The result says how many rows were backfilled.
- **Settings > Bank categories**: lists mappings grouped by bank category; changing one re-applies it to that bank category's rows whose source is `bank` or that are uncategorized; Forget removes it (rows keep their category) so the next import asks again.

## 28. Resolved decisions (Slice 15)

- **Settings > Accounts** (`/settings/accounts`): create, rename, delete. Names are trimmed, 1–50 characters, unique per user ignoring case (unique index on `(user_id, lower(name))`, so races come back as "name taken"). Account names are the user's data and never translated; sign-up still creates "Main account".
- **Delete** confirms with the number of imports and transactions that go, runs in one DB transaction (the account rows are locked, and the FKs cascade to imports, transactions and recurring items), then re-runs recurring detection separately, like undo. **The last account can't be deleted**: the app always needs one to import into.
- **Import** preselects the account of the user's most recent import (derived from `imports`, nothing stored), else the first account. The select appears only with several accounts; otherwise the page says which account the file goes into. The preview names the target account and the history shows each import's account when there are several.
- **Account UI appears only with several accounts**: selects, row labels and account links.
- **Transactions**: `account` URL param (uuid, dropped when invalid) and an Account select; rows and the categorize dialog show the account. Another user's account id returns nothing, since every query is scoped by `user_id`.
- **Dashboard and Recurring**: all accounts by default; a row of links sets `?account=<id>` (ignored unless it is one of the user's accounts). It filters totals, the category chart and drill-down, the trend, Coming up and the next-month forecast, and every link on the page carries it.
- **Recurring per account**: `recurring.account_id` with a composite FK `(account_id, user_id) → accounts(id, user_id)` `ON DELETE CASCADE`; unique `(user_id, account_id, merchant_key)`. Migration `0007_multiple_accounts` backfills each item from its latest linked transaction, else the user's oldest account. Detection runs the unchanged pure `detectRecurring` per account, so the same subscription on two accounts gives two items, and dismissing one doesn't dismiss the other. The staleness reference date stays the user's latest transaction date across all accounts, so a closed account's detected items go stale rather than being forecast forever.
- **Shared across accounts**: categories, rules and bank category mappings stay per user.

## 29. Resolved decisions (Slice 16)

- **An internal transfer is always a pair**: an outflow on one of the user's accounts and the inflow on another. Money sent to or received from an account that isn't in franC is never a transfer: it counts as spending or income and stays in recurring detection and the forecast. There is no one-sided mark.
- **Schema** (migration `0008_internal_transfers`): `transfers (out_transaction_id, in_transaction_id, status)`, each transaction column unique, composite FKs `(transaction_id, user_id) → transactions(id, user_id)` `ON DELETE CASCADE`. So undoing an import or deleting an account removes the pair and the other row becomes an ordinary transaction again. `transfer_rejections` stores unlinked pairs, cascading the same way. Sign, amount and account invariants are checked in app code with the rows locked.
- **Detection** (pure, `src/lib/transfers/detect.ts`): an outflow and an inflow of exactly the same absolute amount, on two different accounts, dated at most 4 days apart in either order, not previously unlinked. Only amounts, dates and accounts count, never labels. Matching is one-to-one and greedy: smallest day gap, then earliest date, then ids. Same-account opposite amounts never pair; coincidences across accounts can, and unlinking them sticks.
- **Bank tag**: a detected pair where either row has the bank subcategory "Virement interne" is stored as `confirmed`; other pairs start as `detected`. An unpaired "Virement interne" row is not marked.
- **When**: after every confirmed import (even with nothing inserted, so re-importing a file scans older data), after undo and after deleting an account, over all unpaired rows of every date. So a transfer pairs when the second account's rows arrive, whenever that is; until then it counts. Transfer detection runs before recurring detection, each in its own step that never fails the import. Detection never removes existing pairs.
- **Detected pairs count as transfers at once**: they are excluded like confirmed ones and marked "Detected" until confirmed.
- **Exclusion**: rows in a transfer are left out of dashboard spent, income, net, the category chart and drill-down, and the trend, also when the dashboard is filtered to one account. A line under the totals counts the pairs not counted (a pair with one row in range or on the selected account counts once) and links to them. Drill-down links carry `transfers=hide` so the list matches the chart. Recurring detection skips them, and re-runs after a link, confirm or unlink.
- **Transactions**: `transfers=hide|only` URL filter; rows in a transfer show a marker with the other account's name. The row dialog shows the counterpart with Confirm and Unlink, or, with several accounts, lets the user link the row by hand to a candidate (opposite equal amount on another account, up to 7 days apart, not already paired). Hand links are `confirmed` and clear an earlier rejection of that pair.

## 30. Resolved decisions (Slice 17)

- **Schema** (migration `0009_category_budgets`): `category_budgets (category_id PK, user_id, amount_cents > 0)`, composite FK `(category_id, user_id) → categories(id, user_id)` `ON DELETE CASCADE`, so deleting a category deletes its budget. At most 10 000 000 € per budget. A separate table rather than a column on `categories`.
- **One amount for every month**: there is no history, so changing a budget changes how past months read too.
- **Roll-up**: a parent's budget covers rows filed on the parent and on its subcategories. A subcategory budget is a limit inside its parent's budget and is never added on top: "total budgeted" counts parent budgets plus the budgets of subcategories whose parent has none. A subcategory budget under an unbudgeted parent stands on its own ("Housing > Rent"). Subcategory budgets may add up to more than the parent's; Settings warns but doesn't block.
- **Moves and deletes** need no special code: a budget follows its category. Deleting a subcategory (either option) drops its budget; deleting a parent while keeping its subcategories leaves their budgets standalone.
- **Spent**: outflows only, like the category chart (§20), so a refund doesn't free budget. Internal transfers never count (§29). Uncategorized spending isn't budgetable.
- **Status**: over when spent > budget, near when spent ≥ 90% of budget, else on track (integer math). Over-budget categories are counted, children included.
- **Computed in SQL** (`getBudgetProgress`, `src/db/queries/budgets.ts`): one `spending` CTE (reusing the dashboard's range and transfer conditions) that Slice 18 can swap for splits. Grouping, status and ordering are pure (`src/lib/budgets/progress.ts`).
- **All accounts**: budgets are per user. When the dashboard is filtered to one account, the Budgets section still counts all accounts and says so.
- **UI**: Settings > Budgets (`/settings/budgets`) lists the category tree with a euro field per row (`400`, `400,50`, `400.50`); saving an empty field removes the budget. The dashboard shows a Budgets section for the selected month, over-budget first, each row linking to that category's outflows for the month.

## 31. Resolved decisions (Slice 18)

- **Schema** (migration `0010_transaction_splits`): `transaction_splits (transaction_id, category_id, amount_cents, position)`, composite FK `(transaction_id, user_id) → transactions(id, user_id)` `ON DELETE CASCADE`, so undoing an import or deleting an account removes the parts. `category_id → categories(id)` `ON DELETE SET NULL`, ownership checked in app code. A transaction is split exactly when it has parts; there is no flag on `transactions`.
- **The original row is untouched**, including its own `category_id` and `category_source`, which are ignored while it is split. Removing the split brings that category back. Re-importing the file still sees the row as a duplicate and keeps the parts.
- **Parts** (pure, `src/lib/splits/validate.ts`): 2 to 20, each with a category and a non-zero amount of the **same sign** as the transaction, summing exactly to it. The editor takes positive euro amounts and applies the transaction's sign.
- **Category lines** (`categoryLines`, `src/db/queries/split-sql.ts`): an unsplit row is one line, a split row one line per part. The category chart, the drill-down and the budgets `spending` CTE read lines; month totals, the trend and counts stay on whole transactions, which is exact because parts share the sign and the sum.
- **Transactions list**: the category filter matches a split row when any part matches (a parent covers its subcategories). `category=none` matches a split only when a part lost its category. A split row shows "Split · names"; under a category filter it also shows the matching parts' amounts next to the full amount. Amount and direction filters use the whole transaction.
- **Untouched by automation**: rules, bank mappings (apply and re-apply) and bulk edit skip split rows; bulk edit reports how many it skipped.
- **Transfers**: a row in a transfer can't be split, and a split row can't be linked, detected or offered as a candidate. Both sides lock the rows, so a concurrent split and link can't both win.
- **Category delete**: parts follow the chosen option (moved to the parent, or left without a category, which puts the split under Uncategorized until fixed). Usage and summary counts are distinct transactions, counting splits through their parts.
- **Export** (Slice 20) must write one line per part.

## 32. Resolved decisions (Slice 19)

- **Usual amount** is the item's `typical_amount_cents`. An alert is raised when the item's newest charge is an outflow more than 10% above it (integer check: `(|charge| − |usual|) × 10 > |usual|`, so exactly +10% doesn't alert). Only **increases on outflows**: price drops and income changes never alert.
- **Renewal only**: the charge must come at least the interval's minimum gap (§21) after the previous charge, so an extra purchase from the same merchant mid-period isn't read as a new price.
- **Both detected and confirmed items** get alerts. Before this slice, a detected item was deleted the month its price rose (the detection run breaks at the new amount), and a confirmed one silently took the new price three charges later.
- **Schema** (migration `0011_recurring_price_alerts`): `recurring_price_alerts`, with composite FKs `(recurring_id, user_id) → recurring` and `(transaction_id, user_id) → transactions`, both `ON DELETE CASCADE`, so undoing the import with the charge, deleting the account or the item removes the alert. `UNIQUE (recurring_id, transaction_id)` keeps a resolved charge from being raised again; a partial unique index allows one open alert per item. `recurring` gained `UNIQUE (id, user_id)` as the FK target.
- **Checked in `refreshRecurring`** (same transaction), so after each import, undo, account delete, transfer change and "Detect now". The check (pure, `src/lib/recurring/price-alerts.ts`) runs against the stored usual amount before the refresh overwrites it, and raises, moves (a newer, still higher charge), or clears the open alert. A charge back within tolerance clears an open alert on its own, so a one-off spike leaves nothing behind. Alerts need an existing item: when one import brings both the first qualifying run and the higher charge, detection starts from the new price and nothing is raised, so a price change is caught when statements are imported at least once per period.
- **While an alert is open** the item is kept even if it no longer qualifies, and its usual amount isn't overwritten; dates and links still refresh. The forecast keeps the usual amount until the user accepts.
- **Accept** marks the alert accepted, sets the usual amount to the new one and confirms the item (one transaction). **Dismiss** keeps the usual amount and covers that charge only: a higher charge next period alerts again.
- **UI**: the Recurring page lists open alerts above the forecast (old → new amount, difference and percentage, Accept new price / Dismiss) and marks the item "Price up". The dashboard shows up to 3 open alerts with a link to Recurring. The import result says how many alerts the import raised. All follow the account filter.

## 33. Resolved decisions (Slice 20)

- **Four CSV files**, each its own download (no zip, so no new dependency): transactions, categories, rules and budgets. The Transactions page has an "Export CSV" link that exports every row matching its current filters (the same `buildWhere` as the list); Settings > Export (`/settings/export`) has all four, with transactions unfiltered.
- **Route** `GET /api/export/[kind]` (`src/app/api/export/[kind]/route.ts`): calls `requireUser()`, re-parses the filters with `parseTransactionFilters` (bad params are dropped, as on the page), and answers `text/csv; charset=utf-8`, `attachment; filename="franc-<kind>-<YYYY-MM-DD>.csv"`, `Cache-Control: no-store`. Every query is scoped by `user_id`. Nothing is logged: an error is a bare 500. The service worker already sends it to the network only.
- **Format follows the user's language**, like a spreadsheet in that language expects: French uses `;` and a decimal comma (`-66,50`), English uses `,` and a decimal point (`-66.50`). Headers and app words (category source, match type) are translated; user data is written as is. UTF-8 with a BOM, CRLF line endings, fields quoted when they contain the delimiter, a quote, CR or LF.
- **Dates** `YYYY-MM-DD` straight from the SQL `date` string. **Amounts** signed (negative = outflow), from integer cents by string arithmetic, never through a float.
- **Formula guard**: a text cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'`, so a crafted bank label can't run as a formula. Amount cells are never prefixed.
- **Transactions columns**: date, account, label, amount, category, subcategory, split part (`2/3`), transaction amount (split lines only), internal transfer (the other account's name), category source, bank category, bank subcategory, bank label. A subcategory fills category with its parent's name. Oldest first.
- **Splits**: one line per part in part order, with the part's category and amount, so the amount column sums to the real total; the row's own ignored category is never written. Under a category filter only the matching parts are written (the category or its subcategories; `none` = parts without a category), so the file adds up to what the category chart shows. The part number still counts all parts.
- **Other files**: categories (category, subcategory, colour, icon; parents then their children, by name), rules (priority order, as in Settings), budgets (category, subcategory, monthly budget). The icon column is empty until Slice 22 fills it.

## 34. Resolved decisions (Slice 21)

- **Three themes**: System (follows the phone or computer, the default), Light and Dark. Saved on the user in `users.theme` (`'system' | 'light' | 'dark'`, null = never chosen, same as System) and carried by the Better Auth session like `locale`. Unlike language, **System is stored explicitly**, so an old `dark` cookie on another device can't override it.
- **Resolution** (`resolveTheme` in `src/lib/theme/config.ts`): saved choice, else the `theme` cookie, else System. The `setTheme` action saves the choice and mirrors it in the cookie (1 year, not httpOnly, like `locale`), so logged-out pages (login, sign up) follow the last choice made on that browser, and the OS otherwise.
- **No flash, no script**: the root layout puts `light` or `dark` on `<html>` for an explicit choice and no class for System. Every colour token in `globals.css` is written once with `light-dark()`, and `color-scheme` is `light dark` on `:root`, `light` on `.light`, `dark` on `.dark`, so the browser paints the right theme from the first frame, native controls included. The Tailwind `dark:` variant means "inside `.dark`, or the OS is dark and not inside `.light`". This needs a 2024-or-newer browser (`light-dark()` and relative colours); older browsers are not supported.
- **Category colours**: stored colours never change. `categoryDisplayColor` (`src/lib/category-color.ts`) paints them as-is in light mode and, in dark mode, lifts too-dark colours to a lightness of at least 0.72 in OKLCH, same hue. Used for pie slices, legend and row dots, budgets, rules and category borders.
- **Charts**: spent (`--chart-1`, orange) and income (`--chart-2`, teal) keep their hue in dark mode, only lighter. Destructive fills (buttons, offline banner) are darker in dark mode so white text keeps its contrast.
- **Status bar**: `theme-color` matches the page background, `#ffffff` in light and `#0a0a0a` in dark; System emits both with `prefers-color-scheme` media. The manifest can't vary by scheme, so its `theme_color` and `background_color` are the dark background (no white splash at night); the page's tag takes over once open.
- **Offline page** follows the OS: it is precached with whatever theme was saved at install, so it drops the theme class on load. The global error page keeps its own OS-following inline styles.
- **Contrast**: the light `--muted-foreground` is `oklch(0.51 0 0)` (shadcn's is 0.556), so hint text also passes on a hovered `bg-accent` row. The a11y E2E runs every main page in both themes and no longer moves the mouse away first.

## 35. Resolved decisions (Slice 22)

- **One emoji per category**, stored in the existing `categories.icon` column (no migration). `categoryIconSchema` (`src/lib/categorize/icon.ts`) trims the value, turns empty or whitespace into `null` (clears the icon), and otherwise accepts exactly one emoji: `^\p{RGI_Emoji}$` with the Unicode `v` flag (built with `new RegExp`, the tsconfig targets ES2017), at most 32 characters. Skin tones, flags and ZWJ sequences pass; text, two emojis, digits and `#` don't. Emojibase spells some emoji with a trailing variation selector that RGI only knows without it (🏠 is U+1F3E0 U+FE0F there), so the schema retries once with the selectors removed and stores that canonical spelling; text-default emoji such as 🛋️ keep theirs. A unit test runs every emoji the picker can produce through the schema. The server action returns the code `icon_invalid`, translated in the form. An update without the field leaves the icon unchanged, `""` clears it.
- **Inheritance**: a category shows its own icon, else its parent's, else the colour dot. Queries return the resolved icon (`coalesce(child.icon, parent.icon)`); the dashboard groups by top-level category, so it shows only the parent's own icon and a child's icon never leaks into or splits a parent's slice. The drill-down buckets show each subcategory's resolved icon.
- **The emoji replaces the colour dot** wherever both would appear (`CategoryMarker`, `src/components/category-marker.tsx`, shared with Slice 23). Colours still paint the donut slices and budget bars, always through `categoryDisplayColor`. The marker is `aria-hidden`: the name is always next to it. Emojis use the device's own emoji font; no image set is bundled.
- **Where it shows**: transaction rows and split parts, dashboard category list and budget card, Settings (categories, budgets, rules), and recurring items. Native `<select>` options can't hold a dot, so their label is `🏠 Housing > 🛋️ Furniture`: the subcategory part only gets an emoji of its own, to avoid repeating the parent's; a category without an icon shows its name alone, as before. That covers the transaction filter, categorize dialog, bulk bar, split editor, rule and budget forms, and the bank-category mappings in the import preview and Settings. The rules list shows the marker next to the plain path label.
- **Recurring items** have no category of their own, so each shows the icon of the category of its **latest charge** (nothing when that charge is uncategorized).
- **Export** already writes the raw stored `icon` (not the inherited one), so a re-import can tell own from inherited. Categories created from bank categories (Slice 14) start without an icon.
- **Picker**: [frimousse](https://github.com/liveblocks/frimousse) (unstyled, virtualized, keyboard-accessible, styled with the Tailwind tokens so it follows the theme) fed by `emojibase-data`, in a dialog opened from a button next to the colour input, with a "Remove icon" button. Search works in the UI language (French keywords in French). The skin tone selector is not offered; emojis keep the default yellow. Group names come from Emojibase's `messages.json`, so they are not in our message files.
- **Self-hosted data**: `/api/emoji-data/{en,fr}/{data,messages}.json` (`src/app/api/emoji-data`) serves exactly the files frimousse requests (`${emojibaseUrl}/${locale}/data.json`, `messages.json`, plus the ETag revalidation requests), with an ETag and a day of caching. The CSP stays `connect-src 'self'`. The paths contain a dot, so `src/proxy.ts` skips them; the data is public and identical for everyone. The service worker caches these GETs (`emoji-data`, stale-while-revalidate, 30 days) so the picker works offline once used.
- **Lazy loading**: the picker is a `next/dynamic` import with `ssr: false`, rendered only while the dialog is open, so the library and the data are fetched on first open and no other page gets heavier.

## 36. Resolved decisions (Slice 23)

- **One active category** drives the chart, the detail card and the list. Mouse hover over a slice and keyboard focus on a list row set it for as long as they last (a row focused by a click doesn't, since the card appearing above the list on a phone would move the row under the pointer); a **touch tap on a slice selects it** and the selection sticks until the same slice is tapped again, the user taps outside the chart and card, presses Escape or the card's close button. Touch vs mouse is read from each pointer event's `pointerType`, not from the screen size, so a touch laptop behaves by input.
- **Click vs tap**: a mouse click on a slice navigates, as before. A touch tap never navigates; the card's **Open** link goes where a mouse click goes (the subcategory breakdown for a category with subcategory spending, else its transactions).
- **Detail card** (`category-detail-card.tsx`): icon or dot, name, amount, share of the month (on a breakdown page, share of the parent), and for a category with subcategory spending one row per subcategory with its amount and **percentage of the category**, largest first; spending filed on the parent itself is its own row, "Housing (no subcategory)". It replaces the Recharts tooltip and sits outside the chart's `aria-hidden` wrapper so its links are reachable. On phones it appears between the chart and the list when a slice is selected; from the `md` breakpoint it sits beside the chart, with a hint in its place, so hovering never moves the page.
- **Subcategory data** for every category comes from one query, `getSubcategoryBreakdown` (same buckets and rules as `getSubcategorySpending`); the breakdown page skips it.
- **Percentages** (`percentShares`, `src/lib/dashboard/shares.ts`): whole percents from integer cents with the largest-remainder method, so every list of shares adds up to exactly 100%; ties go to the earlier (larger) item. A non-zero amount whose share is 0 shows "<1%". Used by the category list, the card and the screen-reader summaries, so the list's percents can differ by one point from plain rounding. Percents are formatted with `formatPercent` (`32 %` in French).
- **Highlight**: the active slice is drawn 6px further out, and its list row gets the hover background and `aria-current`.
- **Icons on slices**: the category's emoji is drawn at the middle of the ring when the slice's middle arc is at least 22px long; smaller slices, categories without an icon and Uncategorized show nothing on the slice (no icons outside the ring, which overlap on a phone). The icon ignores pointer events, so a tap on it hits the slice.
- **Accessibility**: the chart stays decorative (`aria-hidden`, `rootTabIndex={-1}` so nothing inside it takes focus). Each list row carries a screen-reader-only "Subcategories: Rent 80%, Energy 20%" summary. The card is not a live region: it would be read out on every hover.

## 37. Resolved decisions (no emojis on subcategories)

Requested after Slice 23; supersedes the inheritance and option-label bullets of §35.

**Superseded by §66 (2026-10-05)**: subcategories show their own emoji again (Slice 51).

- **Only top-level categories show an emoji.** A subcategory shows its colour dot everywhere (transaction rows and split parts, the drill-down card, budgets, rules, Settings), with no fallback to its parent's emoji, even when an icon is stored for it. Top-level categories keep theirs everywhere, including the donut slices and the list under it. `categoryIcon` (`src/lib/categorize/icon.ts`) returns the own icon only when there is no parent; queries use `case when parent_id is null then icon end`.
- **Native options** carry the parent's emoji only: `🏠 Housing > Furniture`.
- **Recurring items** show the icon of their latest charge's category only when that category is top-level; a charge filed on a subcategory shows nothing.
- **Settings > Categories** hides the icon picker while the form's parent is set. The form then sends no `icon`, so a stored value is kept (no data is deleted) and shows again if the category becomes top-level. The "shows its parent's icon" hint is gone.
- **Export** still writes the raw stored `icon`, subcategories included, so no data is lost.

## 38. Resolved decisions (Slice 24)

- **Schema** (migration `0013_account_balance`): `accounts` gets `starting_balance_cents integer`, `starting_balance_date date` and `low_balance_threshold_cents integer not null default 0`. Check constraints: both starting fields null or both set (`accounts_starting_balance_pair_check`); `abs(starting_balance_cents) <= 1000000000` and `abs(low_balance_threshold_cents) <= 1000000000`, i.e. 10 000 000 EUR like budgets. Columns rather than a table: one value per account, removed with the account.
- **Meaning of the starting balance**: the balance at the **start** of the chosen date, before that day's transactions, so every transaction on or after the date counts. The form says so. The date can't be in the future (compared to today in Europe/Paris).
- **Current balance** is computed in SQL (`getAccountBalances`, `src/db/queries/balance.ts`): starting balance plus the sum of amounts dated on or after the starting date, scoped by `user_id`. Transfers (§29) are ordinary rows: they lower one account and raise the other, so the all-accounts total is unaffected without special code.
- **"As of" and stale imports**: the balance is only known up to the account's latest transaction date (`asOf`, or the day before the starting date when there is none since). The card says "Balance on 14/09/2026", or "today" when that is today. The projection starts the day after `asOf`, so payments expected between the last import and today are counted, and the card notes how many ("Includes N payments expected since your last import").
- **Projection** is pure (`src/lib/balance/projection.ts`, `buildBalanceOverview`) and built on `projectOccurrences`, so cadences, month-end clamping and dismissed items behave as in the forecast; Slice 28 reuses it. Confirmed and detected items both count; a detected item is marked "Detected" wherever it is named. Items with an open price alert keep their usual amount (§32).
- **Warnings** are per account with its own threshold (default 0): the first day the balance is strictly below the threshold (exactly at it doesn't warn), naming the payment that causes it (the largest outflow of that day, "and N more" for the others), or "already below" when it is at `asOf`. The total has no threshold, since an overdraft happens on one account even when another has money. Lowest point = the earliest day with the minimum balance.
- **Accounts without a starting balance** are left out of the projection and the total, and named on the card with a link to Settings > Accounts, so a missing value never makes the total look wrong silently. When no account has one and there are transactions, a one-line prompt replaces the card.
- **UI**: Settings > Accounts rows show "Starting balance 1 234,56 € on 01/09/2026" or "No starting balance", with a Set/Edit balance form (amount with sign, date, "Warn me below") and "Remove starting balance" (which also resets the threshold to 0). The dashboard Balance card sits above the month selector, since it is about now and not the selected month, and follows the account filter: one row per account plus a Total row with several, a small step chart (decorative, `aria-hidden`; a screen-reader sentence gives the lowest point) with a dashed threshold line, warnings in the destructive colour with an icon and text.
- **French wording**: "solde" now means an account balance only; the month's net is "Bilan" (glossary and `common.glossary.net`).
- **Known limitation**: recurring detection skips internal transfers (§29), so a standing order from checking to savings is missing from that account's projection. The total is right; the single account is not. A later slice could detect recurring transfers.

## 39. Resolved decisions (Slice 25)

- **Schema** (migration `0014_merchant_names`): `merchants` (`name` 1–60 chars, unique per user ignoring case) and `merchant_patterns` (enum `merchant_match_type` = `contains | starts_with | equals`, pattern ≤ 200 chars, composite FK to `merchants` with `ON DELETE CASCADE`), plus `transactions.merchant_id` (nullable, `ON DELETE SET NULL`, indexed with `user_id`). One merchant can have several patterns (Intermarché = `INTERMARCHE` + `INTERMAR CENTRE`). `label_raw`, `label_normalized` and `label_display` are never written, so dedupe is unaffected. No regex: the three types are easy to explain.
- **Matching** is pure (`src/lib/merchants/match.ts`) and reuses the rule matcher (plus a `starts_with` branch): a pattern matches when the row's `label_normalized` or the normalized `label_display` matches, so case and accents never matter. **Precedence** when several patterns match: the most specific wins (`equals` > `starts_with` > `contains`), then the longer pattern, then the oldest. There is no priority list to arrange.
- **When names are computed**: for new rows on import (before rules run, and the import preview already shows names), and, after any change in Settings or from a row (add, pattern added or removed, delete), for all of the user's rows in the same transaction (`recomputeMerchants`, which only writes rows whose result changed). Renaming a merchant needs no recompute since rows point at its id. After the commit, rules re-run on uncategorized and bank-categorized rows and recurring detection refreshes (a pure rename skips the latter).
- **Display name** = merchant name, else `label_display`, else `label_raw`. It is used in the transactions list, split editor, transfer section, categorize dialog title, recurring items, Coming up, price alerts, the balance warning and the export `label` column (the `bank label` column stays raw). The spending chart is by category and has no labels. The dialog shows "Bank label: <raw>" under the title when it differs from the shown name.
- **Rules see the merchant name** as a third candidate label, so "Always categorize like this" on a row showing "Orange" works and a rule `contains amazon` catches every row named Amazon. Rules still never touch manual or rule categories.
- **Recurring grouping** uses key `merchant:<id>` (lowercase, so it cannot collide with uppercase label keys) when the row has a merchant, else `merchantKey(label_normalized)` as before. `CB INTERMARCHE` and `CB INTERMAR CENTRE` therefore form one item, and renaming keeps the item since the key is the id. **Re-keying**: before detection, an existing item moves to the group most of its linked transactions now belong to (pure `rekeyItems`), so a confirmed item stays confirmed and keeps its price alerts. When two items merge, the confirmed one survives (then the one with the latest charge). Dismissed items are never re-keyed.
- **Search and filter**: search matches the raw label, the bank's short label and the merchant name (accent- and case-insensitive). A `merchant=<id>` filter (used by the recurring item's "see transactions" link, which falls back to `q` for unnamed items) shows as a removable chip on Transactions, because searching "Orange" would also find an unrelated `ASF ORANGERAIE` toll.
- **Rename from a row**: a "Rename merchant" button in the categorize dialog opens a form with the name (suggesting the user's existing names; an existing name adds the pattern to that merchant, and a row that already has a merchant starts with its name), a match type and a pattern. It starts with **is exactly + the bank's short label**, which is safe by default (`contains ORANGE` would also catch the toll), and a live line "Renames N transactions" (debounced server action, scoped by `user_id`) lets the user widen the pattern before saving. On save the list reloads.
- **Settings > Merchant names** (`/settings/merchants`): merchants by name with their transaction count and patterns; add a merchant (name + first pattern), rename it inline, add and remove patterns, delete it after confirmation (its rows go back to the bank's label). The empty state explains the feature with the Orange example. Server actions call `requireUser()` and validate with Zod. French uses "commerçant".
- **Slice 27**: guessing should learn from the merchant id when a row has one, rather than from the label text.

## 40. Resolved decisions (Slice 26)

- **Column and default**: `transactions.reviewed_at` (timestamptz, nullable, migration `0015_review_queue`) defaults to `now()`, so every older row starts reviewed with no backfill. `commitImport` inserts null explicitly, so only imported rows enter the queue; any other insert path is reviewed by default. Re-importing a file inserts nothing and duplicates keep their state. Undoing an import deletes its rows, so they leave the queue by the existing cascade. A partial index on `(user_id, import_id)` where null keeps the nav counter cheap.
- **What marks a row reviewed**: the explicit "Reviewed" action (one row, a selection, one import's rows, or all); changing the category by hand anywhere (dialog, bulk edit, the review page's picker), even to the same value; saving a split; linking or confirming a transfer (both legs). **Not** renaming a merchant, rules applied to older rows, bank-category backfill, unlinking a transfer, or removing a split. Bulk edit skips split rows (as it always did), so they are neither re-categorized nor marked reviewed and stay in the queue.
- **Undo** puts the rows back (`reviewed_at` null) by id. The status line "Marked N as reviewed · Undo" follows every mark, including the ones made by picking a category, saving a split or confirming a transfer. Undoing does not revert the category that was picked.
- **Page** (`/review`, under `(app)`): a header "N to review" with "Mark all as reviewed" (a confirmation above 20 rows), then the focus card: name, signed amount, date, account (with several accounts), the bank label when it differs, a badge for the category source ("From your rule", "Bank category"), a full-width native category picker (picking saves, marks reviewed and moves on; split rows show their parts instead), Split / Transfer (several accounts only; "Confirm transfer" for a detected pair) / Rename, which open the categorize dialog on that section, a large "Reviewed" button, Previous / Next and "3 of 12". Rows are patched locally, with no reload between rows. Empty state: "All caught up" with links to Transactions and Import.
- **Phone**: only the focus card, tap targets of at least 44 px. **Swipe** (touch and pen, never mouse): right marks reviewed and moves on, left skips to the next row (wrapping) without marking. Pointer events, a threshold of a third of the card width, a vertical-scroll guard (`touch-action: pan-y`), the card follows the finger and snaps back below the threshold; `prefers-reduced-motion` drops the animation. A drag that starts on a button or field is not a swipe, and the buttons stay as the accessible alternative.
- **Desktop (md and up)**: the card plus the whole queue as a list grouped by import (file name, account, upload time, "Mark these N reviewed"), with checkboxes, click to focus, and a bar with "Mark N reviewed" and the category bulk edit. **Shortcuts** (pure mapping in `src/lib/review/shortcuts.ts`, ignored in fields, with a dialog open, or with a modifier key): J/Down next, K/Up previous, Enter/R reviewed and next (Enter on a focused button just activates it), C open the category picker, S split, T transfer, N rename, X toggle selection, U undo, ? help.
- **Counter**: a badge on the Transactions tab of the bottom nav (capped at "99+", with the count in its accessible name), a "Review N new" button next to the Transactions title, a one-line card at the top of the dashboard (all accounts, whatever the account filter), and a "Review the N new transactions" link on the import success screen. No sixth tab. The layout fetches the count once per render and the review actions revalidate it.
- **Cap**: the queue loads at most 500 rows (the header still shows the real total). When they are done, "Load the next ones" reloads the page.
- **French**: valider / à valider / validé / marquer comme validé / "Tout est validé" (see `messages/GLOSSARY.md`).
- **Slice 27**: the card keeps `categorySource` and has a `data-slot="category-source"` block, so a "Guess" badge with an Accept button plugs in without reshaping the page.

## 41. Resolved decisions (Slice 27)

- **Schema** (migration `0016_category_guess`): `category_source` gains `guess`; new table `rule_suggestion_dismissals` (unique per user, match type, pattern and category; composite FK to `categories` with cascade, so deleting a category forgets its dismissals). No confidence column: confidence decides whether a guess is made and is never shown.
- **Algorithm** (pure, `src/lib/categorize/guess.ts`, no external service): examples are the user's newest 5 000 unsplit, non-transfer rows categorized `manual` or `rule`. For a row, neighbours of the **same sign** are searched in three tiers, stopping at the first that has any: same merchant id (weight 1.0), same `merchantKey` (0.95), then similar label (IDF-weighted Jaccard over key tokens, at least 0.6; weight = similarity). Each neighbour votes for its category, weighted by recency (half-life 180 days). **Confidence** = winning share of votes x support (0.8 with one example, 1 with two or more) x tier weight; **threshold 0.6**, below which no guess is made. One earlier example gives 0.76 (guess); Food twice and Restaurants once gives 0.63 (guess Food); one each gives 0.5 (none).
- **Precedence** rule > bank > guess > nothing. A guess fills only rows still uncategorized, never a split row or a transfer leg. `applyRulesInTransaction` and `applyBankMappings` also replace `guess` rows; nothing replaces `manual`; a guess replaces nothing.
- **When it runs**: on import, inside `commitImport`'s transaction after rules and bank mappings, for the new rows ("N categories guessed" on the result screen); and on the review page's **Guess categories** button, one action and one transaction that re-runs rules, re-applies bank mappings, then guesses every uncategorized unsplit row, putting newly guessed rows back in the review queue. The status line reads "Categorized N: x by rules, y from bank categories, z guessed".
- **Accept, change, clear**: Accept turns the guess into `manual` and marks the row reviewed (a hand categorization, per §40); Undo reverts only the reviewed state. Changing or clearing uses the picker as before. "Always categorize like this" works from a guess because the dialog starts with the guessed category selected.
- **Visual marks**: the review card shows a "Guess" badge with a note "Guessed from your past choices"; on a guessed row the big primary button reads **Accept** (shortcut `A`) and swiping right accepts, while R/Enter and bulk "Mark N reviewed" keep the guess as a guess. The Transactions row shows a sparkle icon and italics for a guess and a bank icon for a bank category, each with screen-reader text. The categorize dialog says "Guessed from your past choices" and offers "Accept guess". The export `category source` column can say `guess`. Guessed categories count in the dashboard, budgets and charts like any other.
- **Rule suggestions** (pure, `src/lib/categorize/suggest-rule.ts`): hand (`manual`) rows grouped by merchant id, else `merchantKey`; a group suggests a rule at **3 or more rows in one category** when no manual row of the group is in another category, no existing rule matches, and it was not dismissed. The rule is `equals <merchant name>` for a merchant group, else `contains <merchantKey>` (at least 3 characters). Corrected guesses become `manual` and count. A line "You put N X in Category. Always do this?" with Create rule / Not now shows after a hand categorization (review card, Accept, dialog, bulk edit): under the card on Review, under the toolbar on Transactions. Settings > Rules lists every current suggestion (up to 10) with how many rows it would categorize now. Create rule reuses `createRule` + `applyRulesToUncategorized`; Not now stores a dismissal.
- **Answered questions**: (1) a guessed card's big button is Accept and swipe right accepts, while bulk marking keeps guesses; (2) guessing learns from manual and rule categories; (3) a suggestion after 3 hand categorizations; (4) Guess categories covers every uncategorized row and re-queues newly guessed rows; (5) French "Proposée" / "Proposition" and "Règle suggérée", accept = "Accepter", no confidence shown.

## 42. Resolved decisions (Slice 28)

- **The number**: safe to spend until the end of the current month (Europe/Paris) = balance + confirmed recurring income still due − recurring bills still due − what's left in each budget. Pure and in integer cents (`buildSafeToSpend`, `src/lib/safe-to-spend/compute.ts`). It can be negative.
- **Still due** = occurrences from each account's `asOf + 1` (or the month's first day when earlier) to the month end, from `projectOccurrences`, so cadences, month-end clamping, dismissed items and price alerts behave as in the forecast and the balance card (§38). Payments expected between the last import and today count as due, since the balance only knows up to `asOf`; the card says "Based on your balance on …" when `asOf` isn't today. A bill already paid this month is in the balance and its item's `lastSeenDate` has moved on, so it isn't due again. An occurrence of this month on or before `asOf` that never came (due today but not booked yet, or late) stays due: a bank balance fetched today must not hide today's payment (fix 2026-10-17).
- **Bills**: confirmed and detected outflows both count; detected ones are marked. **Income**: confirmed only; the breakdown counts the detected incomes left out and links to Recurring.
- **Budgets**: the current month's `buildBudgetOverview` top-level items (so the §30 roll-up applies). A budget reserves `max(0, budget − spent − bills still due in it)`: a due bill is taken out of the budget covering its category (its own, else its parent's), so rent with a Housing budget is counted once. Recurring items borrow the latest linked charge's category (`listRecurring.categoryId`). Over-budget categories reserve 0, since the overspending is already out of the balance. Unbudgeted spending reserves nothing.
- **Accounts** (migration `0017_safe_to_spend`): `accounts.in_safe_to_spend` (default true), a "Count in safe to spend" checkbox in Settings > Accounts, so a savings account isn't counted as spendable. Accounts without a starting balance are left out and named. The number ignores the dashboard account filter, like budgets.
- **UI**: a card at the top of the dashboard (under the review banner), "Safe to spend until 31/10", one big number, and a "See how" breakdown (native `<details>`): balance, income expected, bills still due (listed), budgets left (listed), result. A negative result stays visible in the destructive colour with an icon and "X short until …". With no counted account that has a balance, a one-line prompt replaces the card.
- **French**: "Reste à vivre" (chosen by Jérémy), "factures à venir", "revenus attendus".
- **Known limitation**: recurring detection skips internal transfers (§29), so a standing order to savings isn't a bill still due and safe to spend is too high by that amount until it leaves.

## 43. Resolved decisions (Slice 29)

- **Per budget**: each Settings > Budgets row has a "Roll over" checkbox, saved with the amount, so a budget is created with rollover on or off (off by default). Migration `0018_budget_rollover` adds `category_budgets.rollover`, `rollover_start` (first day of a month, checked) and `rollover_base_cents` (bigint).
- **Carry** into a month = base + Σ (budget − spent) over every month from `rollover_start` to the month before. Leftovers add up, overspending takes away with no floor, so the carry can be negative. Months with no spending count as fully unspent. Spending is the §30 figure (outflows only, splits per part, transfers excluded, parent = own + direct subcategories). Pure in `src/lib/budgets/rollover.ts`; `getBudgetProgress` fills `carryCents` for any month.
- **Starts** the month rollover is turned on (Europe/Paris), with a carry of 0: no backdating. Turning it off resets the carry (the save says so); turning it on again starts fresh.
- **Changing the amount** while rollover is on snapshots the carry up to last month into `rollover_base_cents` and moves the start to this month, in one transaction, so the new amount never rewrites past months (§30 budgets keep no history). Past months viewed before the change still read with the current amount, as for any budget.
- **Available** = budget + carry. Status, remaining, over, the bar and "total budgeted" use it. A carry that eats the whole budget reads as over from day one. Each budget row carries on its own: a subcategory budget with rollover carries inside its parent, never added to it. Safe to spend (§42) reserves `max(0, available − spent − bills)`, so money built up for car repairs stays set aside.
- **Display**: the dashboard row reads "€65.00 of €120.00" with "Budget €50.00 + €70.00 carried over" (or "− … overspent in earlier months") under it; Settings shows "Carried into this month: …". The budgets CSV has a Rollover yes/no column.
- **Presets**: under each Settings row, "Last month: …" and "3-month average: …" buttons fill the field (the user still saves). Budgets keep no history, so both come from spending (rolled up like budgets), rounded up to the euro. The average covers the 3 full months before this one, divided by the months since the user's first transaction when that is fewer. A preset of 0 is hidden.
- **Pace**: current month only, from the 5th. A budget not over yet is flagged "On pace to go over" (amber, icon) and sorted right after over-budget ones when recurring charges already paid + bills still due in it (as in §42) + other spending × days in month / day > available. Charges linked to a recurring item (`transactions.recurring_id`) aren't extrapolated, so rent on the 1st doesn't trip it. Integer cross-product in BigInt (`src/lib/budgets/pace.ts`).

## 44. Resolved decisions (Slice 30)

- **Schema** (migration `0019_savings_goals`): `savings_goals` and `savings_goal_contributions` (see §5). Integer cents; the target is bounded like budgets.
- **Source of progress** (superseded in part by §70: a goal now holds the sum of its entries, several goals can share an account): a bank account's balance (§38, as of the last import; a negative balance counts as 0 saved, an account without a starting balance shows a link to set one), or money added and taken out by hand. **One goal per account** (partial unique index), so the same money never counts twice. Deleting the account turns its goal into a manual one; the delete dialog names the goal.
- **Monthly amount** = what's left ÷ months left, rounded up to the cent. Months left count the current month and the target month ("by June" from September = 10). A date in the current month asks for the whole remainder.
- **On track**: a straight line from the plan's start (amount and month) to the target (amount and month), read at the **start of the current month**, so this month's saving isn't due yet. Saved below the line = "Behind by X". Pure in `src/lib/goals/progress.ts` (BigInt cross-product).
- **Restarting the plan**: `start_cents` / `start_date` are today's saved amount when the goal is created, and again when its target, date or source changes (not on a rename or icon change), so an edit never makes past months look missed.
- **Reached** when saved ≥ target, kept with a badge until deleted. **Past target date** once the date's month is over and the goal isn't reached, with no monthly amount. Without a date, only progress is shown.
- **Validation**: the date can't be before today, except an unchanged date when editing. Taking out more than a manual goal holds is refused (the goal row is locked). Entries can't be dated in the future.
- **UI**: a Goals card on the dashboard under the Balance card (goals needing attention first, then by date, reached last; ignores the account filter), and Settings > Goals to create, edit and delete goals, add or take out money and remove entries. The emoji picker is shared with categories.
- **Safe to spend** (§42) is unchanged: a savings account is already left out with its switch.

## 45. Resolved decisions (Slice 31)

- **Schema** (migration `0020_recurring_ended`): `recurring_status` gains `ended`; `recurring.ended_at` and `still_active_at` (dates, nullable). No data change for existing items.
- **Yearly cost** = usual amount × 52 (weekly), 12 (monthly), 4 (quarterly) or 1 (yearly), integer cents (`src/lib/recurring/yearly.ts`). Weekly counts 52, not 365/7, to stay in whole cents.
- **Yearly total** on `/recurring` counts **confirmed outflows only**; detected outflows are a separate "+ X a year from N detected payments to review" line. Income, ended and dismissed items never count. franC can't tell a subscription from rent or a loan, so the total is "recurring payments", not strictly subscriptions. It follows the account and category filters.
- **"Cancelled?"**: a **confirmed** item that missed **2 expected charges** is flagged. Charge k is `last + k·interval` (no-drift stepping, as the forecast) and counts as missed once the reference date is past it by more than a grace period (weekly 2 days, monthly 3, quarterly 7, yearly 10, the detection bands' slack). The reference date is **the latest transaction on the item's account**, not today, so a break in importing never flags anything and an account imported rarely doesn't flag the others. Detected items are never flagged: they go stale on their own.
- **"Still active"** stores the account's latest date; the flag stays hidden until the count of missed charges grows past what it was then. A newer charge resets the count, so the old answer stops mattering.
- **Ended** is a new status, undoable, rather than reusing the final Dismiss. An ended item leaves every projection (next-month forecast, Coming up, balance projection, safe to spend, the yearly total) and loses its open price alert. It keeps its transaction links and its dates. Any confirmed item can be marked ended, not only flagged ones. **Resume** makes it confirmed again and counts as "Still active".
- **Revival**: a charge newer than an ended item's last one brings it back as **confirmed** automatically during refresh (before price alerts are checked). An ended item is never re-suggested as a new detected item, and is deleted like a confirmed one when its transactions are gone.
- **Filter and sort** (`?category=` and `?sort=` on `/recurring`, a plain GET form): the category is the item's latest charge's; picking a top-level category includes its subcategories; "Uncategorized" is offered when an item has none. Only categories in use are listed. Sort is "Next date" (confirmed first, then soonest, as before) or "Yearly cost" (largest outflow first, income last), within each list. The forecast and price alerts aren't filtered by category.

## 46. Resolved decisions (Slice 32)

- **Schema** (migration `0021_tags_notes`): `transactions.note` (text, nullable); `tags` (per user, unique on `(user_id, lower(name))`, so names are case-insensitively unique); `transaction_tags` with composite FKs to `transactions(id, user_id)` and `tags(id, user_id)`, both cascading, so a link can never cross users. Notes and tags are never part of the dedupe hash, so re-importing keeps them.
- **Validation**: a tag name is NFC-normalized, trimmed, inner whitespace collapsed, 1 to 40 characters, and has **no comma** (commas separate tags in the input and in the export). A note is trimmed, at most 500 characters, and an empty one is removed. At most 10 tags per transaction and 200 tags per user.
- **Tags are on the whole transaction**, not on split parts. A trip rarely shares a receipt with everyday spending, and per-part tags would complicate every total.
- **Search** matches notes and tag names as well as labels and the merchant name (accent-insensitive).
- **Tag filter** (`?tag=<id>`): one tag at a time, invalid ids dropped like the other params.
- **Total for the filtered set**: shown whenever a filter is active. It counts **everything the filters show**, internal transfers included unless hidden with the transfers filter, so what you see is what is summed. Under a category filter a split row counts only its matching parts. Summed in SQL as bigint.
- **Bulk**: add a tag (created when new) and remove a tag, on up to 500 loaded rows in one DB transaction. Rows already at 10 tags are skipped and counted.
- **Export**: two columns at the end of the transactions file, tags (sorted, joined with ", ") and note, repeated on every split line so a spreadsheet filter on a tag still sums correctly. No separate tags file.
- Notes are never logged: server actions return codes only.
- French: tag = "Étiquette".

## 47. Resolved decisions (Slice 33)

- **Year page** at `/year` (`?year=`, `?account=`, `?flow=year|YYYY-MM`), reached from a **"See the year" link** in the dashboard's Trend section rather than a sixth bottom-nav tab. No migration.
- **Same figures as the dashboard**: transfers excluded; income and spent on whole transactions, so **refunds count as income**; per-category figures on category lines (splits per part, outflows only), rolled up to top-level categories. Aggregated in SQL (`src/db/queries/year.ts`).
- **Monthly average** divides by the **months covered**: from the first month with data that year (for the scope) to December, or to the current month for the current year, so a year that starts mid-way isn't diluted. Rounded half away from zero in integer cents.
- **Biggest months**: per category row, the peak month (ties all highlighted) when the row has spending in at least 2 months; in the Total row, the 3 biggest months. Tint plus bold plus screen-reader text, never colour alone.
- **Savings rate** = (income − spent) ÷ income, whole percent, can be negative, "—" without income. The year's rate is on year totals.
- **Sankey**: income sources (top 5 + Other income) → Income → spending categories (top 8 + Other) and Saved; an "Other" only groups 2 or more items; when spent > income, a "From your balance" source replaces Saved so both sides add up. Top-level categories only. Built by Recharts' `Sankey` (no new dependency), decorative, with a table equivalent under a native `<details>`.
- French: "Rétrospective de l'année" (not "Bilan", which is the month's net), "taux d'épargne", "Pris sur le solde".

## 48. Resolved decisions (Slice 34)

- **One reminder threshold per user** (`users.import_reminder_days`, default **14**, 1–365, null = off), plus a per-account **"Remind me to import"** switch (`accounts.import_reminder`, on by default) for accounts imported only now and then.
- **Fresh date** = the later of the account's latest transaction and the Paris date of its latest import, so importing a quiet account clears its reminder. **Stale** when today − fresh date > the threshold. Accounts never imported are ignored.
- **Banner on the dashboard only**, at the top, over all accounts, **not dismissible**; it clears on import, on a setting change or by turning the account off. Other screens show **"Data up to …"** instead (dashboard, Coming up, the Recurring forecast).
- **Push notification**, off by default, per device: `web-push` (VAPID) with subscriptions in `push_subscriptions`; a **daily cron** (`/api/cron/daily`, Vercel Cron at 07:00 UTC, Bearer `CRON_SECRET`) sends one when data is stale, then **at most once every 7 days** while it stays stale. The text is generic: no account names, amounts or labels. All push env vars are optional; without them the option is hidden.
- French: "Rappel d'import", "Données jusqu'au …".

## 49. UX redesign decisions (2026-09-30)

A UX/UI review (run on the real app with a year of realistic data, phone and desktop, light and dark, English and French) led to Slices 35–44. Mockups: https://claude.ai/artifact/TR8Jv1VdByJoofSEec9gSd.

- **Colour: Tricolore.** French blue (`#0055A4`, lighter in dark mode) is the brand colour for buttons, links and selection; navy (`#0A2A5E`) for the hero card; the flag red (`#D62839`) appears **only** in the logo's "C" and a thin blue-white-red stripe, never on amounts. It plays on the name: franC, franÇais.
- **Red and green mean money status only**: green = money in or on track, amber = watch out, red = over budget, errors and deletes. Category colours avoid red, green and the brand blue so a category dot is never read as a warning.
- **One thing stands out per screen**: Home leads with safe to spend, then a single "Needs attention" list; details sit one tap away (bottom sheets, "See all").
- **Mobile patterns first**: bottom sheets instead of centred dialogs, swipe actions on rows, lists grouped by day, the frequent action (Import) in thumb reach; desktop uses a sidebar and two columns.
- **Changes save on their own with Undo**, instead of Save buttons and "Are you sure?" dialogs, wherever the data model allows it.
- **Home month picker**: tapping the month name opens a month and year picker (months without data greyed out).
- Subcategories keep showing no emoji (§37): where a row needs a marker, it shows the merchant's initial in the category colour.
- Open choices for each slice (font, recolouring existing categories, bottom bar layout, CSV share target, how "Virement interne" to an account outside franC counts) are settled in that slice's resolved-decisions section.

## 50. Resolved decisions (Slice 35)

- **Existing categories**: only those still on one of the 12 colours the old "Create all" picked are recoloured (migration 0023), since nobody chose those exact values by hand; colours the user picked stay. Known top-level bank names without an icon get their default emoji.
- **Palette**: 12 category colours (`CATEGORY_PALETTE`), each at least 3:1 on white. Top-level categories take the first unused one; subcategories take a shade of their parent.
- **Font**: Figtree, self-hosted through `@fontsource-variable/figtree` (one new dependency, so the CSP and the build need no font host).
- **Dates**: list rows say "Today", "Yesterday", "Tomorrow" or "Mon 28 Sept"; sentences and chart labels say "28 Sept". The year appears only when it isn't the current one. The exact numeric format (`DD/MM/YYYY`) is no longer shown in lists; import history keeps date and time.
- **Headline amounts** (safe to spend, month totals, year totals) are rounded to the euro; lists, details and the safe-to-spend breakdown keep cents. The existing `formatWholeCents` is reused rather than adding a second helper.
- **Uncategorized** is labelled at the UI edge: spending queries return a null name.
- **Starting account name**: new users get it in their sign-up language ("Compte principal" in French). Instead of translating "Main account" on display everywhere an account name appears, migration 0024 renames it for users who saved French as their language; anyone else can rename it in Settings.

## 51. Resolved decisions (Slice 36)

- **Bottom bar** (D3 default): Home · Transactions · a raised **＋ Import** button · Plan · More. The review badge stays on Transactions. From 1024 px a left sidebar with the same entries and an Import button replaces the bar.
- **URLs are unchanged.** Budgets and Goals stay at `/settings/budgets` and `/settings/goals` but belong to Plan (the Plan entry lights up there and their back arrow goes to Plan); More is the `/settings` page, so "Settings" keeps working as a route. Moving them would have touched ~40 links and revalidations for no visible gain: the installed app never shows URLs. `/plan` is the only new route.
- **Plan shows live summaries**, as on the mockup: this month's budgets (same pace as Home), goals, recurring payments per month and how many to confirm, next month's expected net (opening the forecast, which stays on the Recurring page until Slice 41), and Year in review. It always covers all accounts.
- **French**: the Plan tab is **"Budget"** (a noun like the other tabs, as in French bank apps); More is **"Plus"**. The Plan page title follows the tab.
- **One page header** everywhere: title as the page's only `<h1>`, an optional 44 px back arrow ("Back to Plan", "Back to More", "Back to Transactions"), at most one action. Home keeps the wordmark as its title on phones and says "Home" on a computer, where the sidebar shows the wordmark.
- **"Go deeper" links** are full-width rows (`RowLink`) or card footers (`CardFooterLink`) with a chevron; links inside a sentence stay inline.

## 52. Resolved decisions (Slice 37)

- **Home order**: safe to spend, then one "Needs attention" list, then the month section (switcher, totals, budgets, spending by category, trend), then Balance, Coming up and Goals. On a computer, the overview is on the left and the month on the right.
- **Per day** = safe to spend ÷ days left in the month, today included, rounded down; not shown when nothing is left.
- **Next month near the end** (plan choice A): from the 28th the hero adds next month's forecast net ("October: +€1,323 expected"), the number Plan already shows, rather than a projected balance on the 1st, which would repeat the Balance card.
- **One place for alerts** (choice B): the import reminder, review count, over-budget and ahead-of-pace budgets, price increases and low-balance warnings exist only as "Needs attention" rows. The order is a balance already below its alert level, then stale import, review, over budget, ahead of pace, price increases and low balance ahead. Up to 2 budgets or price alerts get their own rows; from 3 they collapse into one. The list ignores the account filter, as the old banners did.
- **Trend kept** (choice C) at the bottom of the month section; the month picker shows each month's spending too, but the trend compares spending with income.
- **Month picker**: a bottom sheet (dialog on desktop) with year arrows bounded by the first year with data and the current year, a 12-month grid with compact spent amounts, months without transactions and future months greyed out and disabled, the current month always available, and "Back to this month". Its amounts follow the account filter. One history query feeds the picker, the trend and "latest month with data".
- **Bottom sheet** component on Radix Dialog (already a dependency) rather than a new drawer library; Slices 38 and 39 reuse it.
- **No red on amounts**, including the hero (a shortfall is white, with an amber line), the month net and balances. The balance chart's alert line is amber: it's a threshold, not a loss.
- **Compact cards**: budgets show the top 3 with "See all N budgets"; categories the top 5 with "See all categories"; Coming up 3 rows without "Detected" badges; goals at most 3.

## 53. Resolved decisions (Slice 38)

- **Grouped by day** with a sticky header ("Today", "Yesterday", "Mon 28 Sept") and the day's net total. The total comes from the server for the whole day and the current filters, so a day cut across two pages is still right; it is green when positive and plain otherwise (no red on amounts).
- **Row name** (plan choice A): the merchant name, else the bank label, title-cased only when the bank wrote it all in capitals. Words with digits, dots, `*`, `/` or `@` stay as written, and short joining words ("de", "la", "et"…) are lower-cased. Acronyms can't be told from words ("PRLV SEPA EDF" → "Prlv Sepa Edf"): merchant names are the fix.
- **Row marker**: the top-level category's emoji, else the name's first letter in the category colour (subcategories still show no emoji, §37). The row shows the category's own name, not "Parent > Child"; the date moves to the day header; the bank icon and raw label stay in the dialog.
- **Live search** after a 300 ms pause, replacing the URL (no history entry per keystroke); Enter and the no-JS GET form still work.
- **Filters**: quick chips (This month, Expenses, Income, Uncategorized) and one removable chip per other active filter, all plain links; the full set lives in a bottom sheet with Apply and Clear all (which keeps the search).
- **Dates** (choice B): period presets plus From/To typed as DD/MM/YYYY, because native date pickers follow the browser's language, not franC's. URLs keep ISO dates and also accept DD/MM/YYYY.
- **Swipes**: right opens a category picker sheet (a split row opens the dialog instead); left opens an actions sheet (change category, split, note and tags, rename merchant, transfer, select). Both reuse the review screen's gesture rules and are off in selection mode. Until Slice 39 the actions open the existing dialog at that section; there is no undo toast yet.
- **Keyboard and mouse** (choice C): a ⋯ button per row opens the same actions sheet; visible from `md`, shown on focus on phones.
- **Review link** (choice D): a full-width "N to review ›" row above the list; the header's one action is the ⋯ menu with Select and Export CSV.

## 54. Resolved decisions (Slice 39)

- **Detail sheet** replaces the categorize dialog: a bottom sheet on a phone, a dialog from `lg` (the Slice 37 sheet). Header with name, amount (never red), friendly date, account and raw bank label; a main view, and steps (category, split, transfer, rename, new rule) inside the same sheet with a back button.
- **Fields save on their own**: category on tap, note 1 s after typing stops and on blur or close (choice A), tags on Enter, comma or a suggestion. No Save, Update or Add buttons. The sheet **stays open** after a change (choice B).
- **Split and rename keep one confirm button** (choice C): a split has to add up, and a rename changes every matching transaction.
- **"Saved · Undo" toast**, home-made (no new dependency), one at a time, 6 s, paused on hover or focus, rendered inside an open sheet so it stays in the focus trap. Slice 43 reuses it. Undo covers category (previous category, source and review state, sent by the client and checked by the server), note, tags, split, transfer link and unlink, merchant rename (deletes the new merchant or the added pattern), and rule creation (deletes the rule and clears only the rows it categorized that still carry it). Confirming a detected transfer has no Undo; unlink does the same.
- **"Always categorize like this" is a suggestion** shown after a hand category change: the merchant name, else the label's merchant key, as `contains`; Create rule, Adjust or dismiss. The 3-hand-categorizations suggestion (§41) wins when it applies. The page-level suggestion line stays for swipes and bulk edits.
- **Same everywhere** (choice D): the swipe-right picker, the sheet's category step and the review card use one searchable category list; the review card's Split, Transfer, Rename and new Note and tags buttons open the detail sheet. Undoing a category change in review puts the card back in the queue.

## 55. Resolved decisions (Slice 40)

- **Welcome checklist** on Home for new users: Import your bank export, Check your categories, Enter your balance, Set a first budget. Each step ticks itself from existing data (any transaction; imported and nothing left to review; any starting balance; any budget). Before the first import it is the whole Home.
- **Remembered once done** (plan choice A): when all four are done, or the user taps Hide, `users.welcome_completed_at` is set and the checklist never returns, even if a later import leaves rows to review. Migration 0025 sets it for users who already had transactions.
- **Import previews on file choice**: a large "Choose your bank export" area (drag and drop on a computer) replaces the raw input and the Preview button. The preview leads with a summary (new, duplicates, errors, date range of the new rows); the rows are folded away, the errors are not.
- **"Create" preselected** for every undecided bank category on **every** import (choice B), the list folded under "Customise (N)". A plan suggestion (an existing category of the same name) is kept.
- **One button after a first import or one of 50+ rows**: "Guess categories, then mark all as reviewed" runs Guess categories, then marks reviewed only that import's rows that got a category (choice C); uncategorized rows stay in the queue. Undo puts the marked rows back; guesses stay. "Review one by one" is the alternative.
- **Share target** (D5, choice D): the manifest's `share_target` posts to `/import/share`, which the service worker answers by parking the file in a `share-target` cache and redirecting to `/import?shared=1`; the page takes the file out and deletes it at once. It works on Android with the installed app; iOS has no share targets.

## 56. Resolved decisions (Slice 41)

- **"Regular payments"** replaces the Recurring page's stacked cards. It leads with **"€X a month in bills and subscriptions"** (and the yearly figure). The headline counts **confirmed and detected** outflows (plan choice A), with "Includes €Y a month from N not yet confirmed" whenever detected ones are in it; income, ended and dismissed items never count. Plan's Regular payments row shows the same monthly number.
- **"Confirm all"** confirms every detected item in the current view in one transaction; Undo sets exactly those back to detected.
- **Compact rows** (avatar, name, amount, "Every month · next Mon 5 Oct"), in **Bills and subscriptions**, **Income**, then collapsed **Ended** and **Dismissed** sections. Rows with an open price alert or a "Cancelled?" flag come first and say so in their caption. Tapping a row opens a sheet with the last 12 charges, the price alert, the "Cancelled?" question and the actions; `?item=<id>` opens it directly (from Home's price alerts and Coming up).
- **Swipe** (touch only): right confirms a detected item, left dismisses a detected or confirmed one. Every action shows a toast with Undo; confirmation dialogs are gone.
- **Dismiss is undoable** (choice B): Undo restores the previous status, and **Restore** in the Dismissed section makes the item confirmed. Both re-run detection so the item's transactions are linked again. Until restored, a dismissed item is still never re-suggested.
- **Next month moves to Plan** (choice C): `/plan/next-month` shows the forecast that was on the Recurring page; the Plan row and the safe-to-spend hero link there. The forecast net is no longer red (Tricolore rule), nor is a price increase.
- **Category filter and sort are two chips** that apply at once (choice D), replacing the form with Apply.

## 57. Resolved decisions (Slice 42)

- **Lists first**: Budgets, Categories, Rules, Tags, Merchants, Goals and Accounts open on your items. "＋ Add" in the header opens a sheet; there are no Add forms above the list any more. Tags have no Add (they come from transactions).
- **One "⋯" menu per row** (plan choice A): a small popover menu on Radix Dropdown Menu (new dependency, same family as the dialogs), destructive item last. Tapping a row opens its edit sheet. Names wrap, never truncated. `?add=1` and `?edit=<id>` open the sheets, so other screens can link to them.
- **Budgets show only budgeted categories** with this month's bars. "Add a budget" lists the others by 3-month average spending and prefills the average; the edit sheet has "Use average" and "Last month" chips, Roll over, Save and Remove budget. An empty amount no longer removes a budget.
- **Deletes offer Undo** where the data can be put back exactly: budgets (with their carry), rules (same place in the order), tags (re-linked to the transactions that still exist), merchants (with their patterns, re-matched), merchant patterns, goals (with their entries), and categories nothing uses (plan choice B). The client sends the snapshot back; the server validates it and restores it in one transaction with the same ids.
- **A category in use** still opens the move/uncategorize choices, in a sheet, and can't be undone (choice B). **Deleting an account** keeps its confirmation (choice C): its imports and transactions go with it.
- **Category captions** read "3 subcategories · €875 this month" (choice D), in whole euros.

## 58. Resolved decisions (Slice 43)

- **One toast for every result**: a field's validation error stays under the field; the result of an action, and an action that failed, is a toast (above the bottom bar, or inside an open sheet). The page never grows a "Saved" line. Successes are announced politely (`status`, 6 s); errors interrupt (`alert`), stay 10 s and offer **Try again** where repeating makes sense. One toast at a time: a new one replaces the old. The toast fades out instead of vanishing.
- **Theme and language show no "Saved"** (plan choice D): the page changing is the feedback; only a failure shows a toast.
- **Instant category changes and confirmations**: the swipe picker, the sheet's category step, bulk Categorize and tags, the review card, Mark reviewed (one, an import, all) and Accept guess change the screen at once; server calls go in tap order, so an Undo tapped while the save is in flight reaches the server after it. **A failure puts the rows back** (a newer change to the row wins) with an error toast and Try again (choice C). The "Always put X in Y?" suggestion still waits for the server.
- **Motion is short and quiet** (≤ 250 ms; bars 450 ms) and **follows the device's "reduce motion"** setting, with no switch in the app (choice B). One CSS guard cuts every animation, transition and view transition under reduce motion.
- **List changes animate with React's built-in `<ViewTransition>`** (choice A, no dependency) on Regular payments and the managed lists, not on the virtualized Transactions list or the review card (an update during a view transition swallowed typing in the open sheet): rows that leave fade out and the others slide into place; rows put back by Undo fade in. Browsers without view transitions change instantly. Progress bars fill from empty and slide to a new width. Buttons and rows have a pressed state; buttons doing work show a spinner.
- **One empty-state look** modelled on "All caught up": round soft icon, short title, one sentence, one primary action (and at most one quiet link). Home cards use a compact version. Never red.
- **Skeletons match their pages**, including every More/Settings screen (they used to fall back to Home's), with a soft shimmer instead of a blink.

## 59. Resolved decisions (Slice 44)

- **The Year page says it in words.** A soft brand-blue card leads with one sentence: "You saved €X" with the savings rate, "You spent €X more than you earned" (plain, never red; "Your balance covered the difference"), "You spent what you earned" when the difference rounds to €0, or "You spent €X" when there was no income. "So far in {year}" for the current year. Income and Spent sit under it; the Saved and Savings rate cards are gone (plan choice A).
- **Best and toughest months are named**, each linking to that month on Home: highest and lowest saved, over **finished months with data** (choice B: the current month is left out, a month whose salary has arrived but whose bills haven't would always look best). Shown with at least 2 such months and only when they differ; ties go to the earliest. When even the lowest month saved, it reads "Lowest month".
- **No "−0"**: percentages and whole-euro amounts that round to zero carry no sign, everywhere.
- **No red on Year amounts**: Saved is green when positive and plain when negative (choice D), like the month net on Home.
- **One chart style**: Spent in French blue (`--chart-1`), Income in green (`--chart-2`), balance in brand blue, thresholds amber, categories in their own colours; never red. One tooltip, one legend (dots with plain text, above the chart), amounts on the Y axis of bar charts (0, middle, top on a round step, compact).
- **Tap to see values** (choice C), the donut's rule for every chart: with a mouse, hover shows the values and a click goes deeper; on touch, a tap selects and shows a readout under the chart with an "Open …" link, so a slip of the finger never navigates. The Sankey's readout gives a node's full name, amount and share. Charts stay decorative (`aria-hidden`); their tables and lists remain the accessible path.

## 60. Automatic bank sync decisions (2026-10-02)

A deep dive (`plans/bank-sync.md` in the project files) into the Caisse d'Épargne API, aggregators and how YNAB, Actual Budget, Lunch Money, Monarch, Bankin' and Linxo handle automatic import led to Slices 45–49. Bank connections leave the non-goals (§3).

- **Provider: Enable Banking, free "restricted production" mode.** Caisse d'Épargne's own PSD2 API (BPCE, STET v1.6.2) is only open to licensed AISPs, so an aggregator is required. Enable Banking's free mode reads only accounts linked to the app owner's Enable Banking application, which fits a personal deployment. Paid aggregators (Bridge from €499/month, Salt Edge $500/month, Tink, Powens) need a company contract; personal resellers (Lunch Flow, Synci) cost a few euros a month and add a second company holding the data. Lunch Flow is the fallback if Enable Banking's sign-up fails.
- **Bank limits shape the design:** 4 unattended fetches a day per account, 90 days of history on the first sync, consent for 180 days, no bank categories in the API.
- **Daily limits (checked 2026-10-05):** Enable Banking's free mode has no call quota of its own that we found; the limit is the bank's. PSD2 (RTS Art. 36(5)(b)) caps fetches made without the user at 4 a day per account, for transactions and balances separately. A request carrying the `Psu-Ip-Address`/`Psu-User-Agent` headers counts as made with the user present and is not counted (Enable Banking FAQ; Triodos and other banks' docs say the same). **Sync now** sends them (`psuFromHeaders`), so manual syncs are not limited by this rule; the daily cron sends none and uses 1 of the 4. So franC shows no "syncs left" counter (it would always read "unlimited" for Sync now); instead a 429 (`ASPSP_RATE_LIMIT_EXCEEDED`) gets its own message (Slice 49). Inferred, not tested on production: that BPCE honours the PSU headers as the regulation requires.
- **Booked transactions only.** Pending payments can change id and amount when they post; showing them (display only) is a later idea.
- **Manual and automatic imports:** sync owns dates from its start date; CSV stays for older history and gaps. A matcher links the same transaction across sources: same `external_id`, else same account and amount within ±3 days. One candidate is merged automatically; several go to Review as "Possible duplicate" (Same transaction / Keep both). The CSV `dedupe_hash` rule is unchanged. Sync runs have no Undo; unwanted synced rows can be ignored.
- **Balance:** on a connected account the bank's balance is authoritative and read-only, like Lunch Money, Monarch and Bankin'. franC keeps balance checkpoints and flags gaps when its transactions don't add up to the bank's change, offering a CSV import for those dates or an adjustment. Unconnected accounts keep the manual starting balance.
- **Categories:** synced rows skip bank-category mapping and go through rules, then guessing, which learns from past choices and never used bank categories. Synced rows get a short label (bank prefixes and suffixes stripped, or the matched CSV row's) so rules and merchant names keep matching.
- **Frequency:** once a day with the existing 07:00 UTC cron (Vercel Hobby allows one daily job), plus "Sync now".
- **Notifications:** only "reconnect needed" (from 14 days before consent ends) and "sync failing"; the import reminder only watches unconnected accounts.
- **Import button (Slice 49, Jérémy's choice, 2026-10-02):** once sync runs daily, manual import is rare, so the raised Import button (and the sidebar's) shows only while at least one account has no bank link. With every account connected, the bar is four equal tabs; sync status and **Sync now** sit on Home (not in the centre slot, since the bank allows only 4 unattended fetches a day), pull-to-refresh syncs, and **Import a CSV** moves to More and the Bank connection page. Users without bank sync see no change.

## 61. Resolved decisions (Slice 45)

- **Enable Banking flow confirmed** from its official code samples (its site is blocked from the cloud environment): RS256 JWT with `kid` = application id, `iss` `enablebanking.com`, `aud` `api.enablebanking.com`; `GET /aspsps`, `POST /auth`, `POST /sessions`, `DELETE /sessions/{id}`. Sandbox applications accept a localhost redirect and offer a "Mock ASPSP" bank. Signed with `node:crypto`, no new dependency.
- **Hidden unless configured, and owner only**: without `ENABLE_BANKING_APP_ID` and `ENABLE_BANKING_PRIVATE_KEY` there is no More row and the page is a 404. Bank sync is also limited to `BANK_SYNC_EMAILS` (unset = nobody), because the free mode reads the application owner's linked accounts and other people may have an account on the same deployment (Jérémy's request, 2026-10-02). The key is accepted as PEM, PEM with `\n`, or base64, because env-var boxes handle multi-line values differently.
- **More > Bank connection** (plan default 1), a row after Accounts.
- **All French banks, Caisse d'Épargne first, with search** (default 2), rather than Caisse d'Épargne only, so the sandbox's Mock ASPSP and a future bank change need nothing new.
- **Disconnect never touches data** (default 3): it ends the consent at Enable Banking (best effort) and deletes the connection and its pairings; every transaction, import and account stays. Connecting again asks for the pairings again; Slice 49's Reconnect will keep them.
- **Default pairing** (default 4): the franC account with the same name; else the user's only free account for the first bank account; else a new account named after the bank's. A franC account is fed by one bank account at most (DB partial unique index).
- **Security**: the jump to the bank is a GET link to a route (the CSP's `form-action 'self'` would block a form redirecting off-site); the callback's one-time `state` must match a pending connection of the signed-in user; pending attempts expire after 1 hour; only the last 4 IBAN characters are stored; error codes, never response bodies, reach the logs.
- **Consent length**: 180 days, or the bank's `maximum_consent_validity` when shorter; the session's own `valid_until` wins.
- **Tests run against a fake Enable Banking server** that Playwright starts on port 3100 with a key pair generated per run; nothing secret is committed.
- **Production keys wait for Slice 46**: connecting the real bank before transactions can be fetched brings nothing in and starts the 180-day consent early. The sandbox application is enough to try Slice 45.

## 62. Resolved decisions (Slice 46)

- **Real-data check** (Jérémy's account, 2 Oct 2026, through a temporary owner-only "Compare with a CSV" report that showed counts and masked label shapes only). Over 90 days the API sent 351 rows, all `BOOK`; 329 paired with the CSV (6 Jul to 1 Oct).
  - **Dates:** only `booking_date` is filled (`transaction_date` and `value_date` never). It equals the CSV's *Date de comptabilisation* (307/329), not its *Date operation* (87/329). Card payments carry their operation date in the label (`FACT ddmmyy`); other rows are booked the day they happen. Deriving the date that way gives the CSV's operation date for 303/329 paired rows; most of the rest are likely mis-pairs between same-amount payments rather than wrong dates. **Synced rows store that derived operation date**, keeping franC's rule that a row's date is when you paid.
  - **Labels:** one `remittance_information` line, the CSV's *Libelle operation* plus a trailing reference after `FACT ddmmyy` (card payments) and the `RETRAIT DAB` id. With that reference dropped, 281/329 equal the CSV's long label; most of the rest are transfers the CSV words differently (`VIR SEPA X` vs `X`, `X REM X` vs `REM X`, internal transfers). No counterparty, no code description, no short label.
  - **Same dedupe hash as the CSV row** (derived date, amount, cleaned label) for 277/329: the existing unique constraint already stops most CSV/sync duplicates; the overlap rule below covers the rest until Slice 47's matcher (§63).
  - **Ids:** `entry_reference` is always filled, unique, never a placeholder, and never equal to the CSV's `Reference`. It is stored as `external_id` (sync-to-sync duplicates only).
  - **Short labels:** stripping prefixes and suffixes gives the CSV's short label for 181/329; learning from the other CSV rows (stripped long label → short label) for 271/329. Synced rows use the learned label, else the stripped one.
- **Start date chosen in the link step** (default 2): the day after the newest transaction on that franC account, at most 89 days back (90 days including today); shown as a date field the user can change within those limits.
- **Every sync run appears in import history** (Jérémy's choice, not the plan's default), including runs that bring nothing. **No Undo** on sync runs (§60).

## 63. Resolved decisions (Slice 47)

- **Merge memory is a table**: `transaction_matches` records every identity (source, dedupe hash and occurrence, `external_id`) merged into a kept transaction, with the import that brought it. Exact checks look at it as well as at `transactions`, so a merged row never returns on a re-sync or a re-import. Its foreign keys cascade: undoing the CSV import that made a merge forgets it, deleting the kept row forgets its matches.
- **Matcher order** (one pure function, `src/lib/bank-sync/match.ts`, for a sync and a CSV import alike, run on the whole batch): same `external_id`, then same hash and occurrence, then the fuzzy pass (same account, same amount, within ±3 days). The overlap rule of §62 is gone.
- **Other side only**: a synced row can only match a CSV row with no bank identity yet, and a CSV row only a synced row with no CSV match yet. Rows of the same side are never fuzzy-matched (two real coffees stay two), and each candidate absorbs at most one incoming row. Ignored rows stay candidates so an ignored duplicate stays ignored.
- **Tie-break**: one candidate is merged. Several candidates but exactly one on the same date: merged with that one, which keeps the overlap rule's old behaviour and avoids flooding Review with two coffees on consecutive days. Otherwise the row is inserted as a **possible duplicate** with its candidates in `duplicate_candidates`.
- **`link`**: when a CSV row and a synced row share a dedupe hash, the pair is recorded as a match on the existing row, so that row cannot absorb a second purchase later.
- **Possible duplicates count in totals** like any row until the user decides (they are real rows waiting in Review).
- **Keep both is remembered** simply because only incoming rows are ever matched: a row already in franC is never looked at again.
- **Same transaction has no Undo** (a sync cannot be undone either): the incoming row's identity moves onto the candidate, which keeps its category, note, tags and splits, and the incoming row is deleted.
- **Ignore** (`transactions.ignored_at`) excludes a transaction from totals, budgets, the year view, recurring detection, transfer pairing, guessing and the **account balance**, but keeps it for dedupe and matching so it never comes back. Ignoring marks it reviewed. A leg of an internal transfer cannot be ignored (unlink first, so totals stay coherent). The list hides ignored rows unless the `ignored` filter says otherwise. French wording is **« Écarter »**, because « ignorer » already means skipping a regular payment (GLOSSARY).
- **Origin line**: "From your bank" for a synced row, "From CSV, 12 Sept" for an imported one, using the import's `uploaded_at` as a Europe/Paris day (an import's date, not the transaction's).

## 64. Resolved decisions (Slice 48)

- **Balance checkpoints are a table**: `balance_checkpoints` holds "the balance was X at the end of day D", with a source (`manual` or `bank`). One manual checkpoint per account, one bank checkpoint per account and day (a second sync the same day updates it). The old starting balance ("balance at the start of day D") is copied by the migration as a manual checkpoint dated **D − 1**, so the figure shown is exactly what it was.
- **Old columns kept unread**: `accounts.starting_balance_cents` and `starting_balance_date` stay in place and are no longer read. A later cleanup migration drops them. Reason: Vercel runs migrations at build time while the previous deployment still serves traffic, so dropping them now would break the live app for a few minutes (or for good if the build failed after migrating).
- **`transactions.booked_on`**: the bank's balance covers what it has **booked**. A card payment made on 1 Oct and booked on 3 Oct is dated 1 Oct in franC (the operation date, §62) but isn't in the bank's balance for 2 Oct, so comparing by franC's date would raise false gaps around every checkpoint. The booking date is stored (synced rows' `booking_date`, the CSV's *Date de comptabilisation*; filled on the kept row when a merge happens) and the balance and gap check count rows by `coalesce(booked_on, date)`. Existing rows stay null and fall back to `date`.
- **Balance type order**: booked balances only, `CLBD` (closing booked) > `ITBD` (interim booked) > `OTHR`. `XPCD` and `ITAV` include pending card payments, which franC doesn't import. Checked on a real sync (2026-10-19): Caisse d'Épargne sends only `CLBD`, and only `BOOK` transactions even with card payments still "en cours", so pending card payments can't be shown from bank sync. A failing balance call never fails the sync.
- **Gap = running difference, starting at the starting balance** (Jérémy's pick): the series starts at the manual starting balance as the first checkpoint, so gaps in the history imported before the first sync are found too. If the starting balance typed was off, one gap shows at once and **Accept** clears it for good. Per checkpoint, difference = the bank's change since the start − franC's booked movement − gaps already accepted; offsetting differences cancel. The gap is reported between the last checkpoint where franC agreed and the first after which the difference stayed. Only connected accounts are checked.
- **Gap sign**: amount = the bank's change − franC's movement. Negative = the bank shows less than franC adds up to; positive = more. Worded neutrally ("your bank shows €42.10 less/more than franC between 3 and 9 Sept"), since either can have several causes (spending or income missing, a duplicate).
- **Accept the bank's balance is a note, not a transaction** (Jérémy's pick): the difference is stored in `accepted_gap_cents` on the latest bank checkpoint, with Undo. Spending totals, budgets and the year view don't move; nothing shows in the transactions list.
- **Bank balance is read-only**: on a connected, synced account the amount and date can't be edited (the server refuses); "Warn me below", Safe to spend and the import reminder stay editable.
- **Disconnect copies the bank balance to the manual one**: each linked account's latest bank checkpoint becomes its manual checkpoint, so it keeps its last bank balance and is editable again. Bank checkpoints stay as history.

## 65. Resolved decisions (Slice 49)

- **One daily cron plus sync on open**: Vercel Hobby allows one cron a day, so `/api/cron/daily` (07:00 UTC) syncs every healthy connection, then sends the import reminder and the bank health push. On top of it, opening franC (or the tab becoming visible) syncs imported links whose data is **over 2 hours old**, with the PSU headers: the bank counts that as attended, not as one of its 4 unattended fetches a day (§60). Jérémy's pick over four crons a day: fresh data when he looks, and no dependency on the cron plan. A link that was never synced is left to its first Sync now (its start date can still change, and the first sync can bring 90 days); the daily job does sync it. The server re-checks the 2 hours, so tabs and reloads never make more than one sync. No toast on success; failures show through the status.
- **No pull to sync**: dropped from the slice. Sync on open and Home's Sync now cover it.
- **Health states and precedence**: `reconnect` (the consent ends in 14 days or less, has ended, or the last attempt said `unauthorized`) beats `failing` (an imported link has `failing_since`) beats `rateLimited` beats `ok` / `never`. Home reads "Reconnect your bank" without a date when the bank refused a still-valid session.
- **14-day reconnect window**: far enough ahead to act on a morning push, short enough that the row doesn't sit there for months of a 180-day consent.
- **A rate limit isn't a failure**: a 429 `ASPSP_RATE_LIMIT_EXCEEDED` is its own code, shown as a sentence ("franC will try again tomorrow morning"), never sets `failing_since` and is no Needs attention row.
- **Failing push from the second failed morning**: Home shows "Sync failing since …" from the first failure; the push waits for a second failed morning in a row (and is sent at most weekly, like the import reminder) so one bad night doesn't buzz the phone.
- **Import button rule**: the raised Import button and the sidebar's Import button show only while bank sync is available to the user and some account has no bank link. Once every account is connected (an expired connection still counts), the bar is four equal tabs and **Import a CSV** is a row in More and a link on the Bank connection page.
- **Home sync line whenever connected** (Jérémy's pick): "Synced at 07:00 · Sync now" shows as soon as one account is fed by a bank link, even while a manual account keeps the Import button.
- **Reconnect pairing**: a new bank account takes over an old link by the same uid, else the same Enable Banking `identification_hash`, else the same IBAN last 4 and name. The old connection is replaced in one transaction; transactions, matches and checkpoints belong to franC accounts and stay.
- **Migration 0030 only adds nullable columns** (`bank_account_links` health columns and `identification_hash`, `bank_connections.replaces_connection_id`, `users.bank_health_notified_on`), so no existing row changes and the previous deployment keeps working while the build migrates.

## 66. Feedback decisions (2026-10-05)

From feedback on the app (Slices 50–54 in `SLICES.md`). Jérémy's answers to the proposal in `/mnt/project-files/plans/feedback-slices.md`.

- **Order**: bug fixes first (Slice 50), then easier categories, savings, variable regular payments. The planned "Create a category while categorizing" moves last, as Slice 54.
- **Subcategory emojis are back** (supersedes §37): a subcategory shows its own emoji when it has one, else its colour dot; still no fallback to the parent's emoji. On the subcategory donut a slice shows its colour and its emoji, like top-level categories. Subcategory colours were already editable, so nothing changes there.
- **Savings via a manual account** (Jérémy's pick over marking a category or each transaction): transfers are always pairs (§29) and there is no manual entry, so **Move to savings** on an outflow creates the matching row on a manual account and links the pair. A rule on the label can do it for future rows. Home shows **Saved** (money into accounts outside safe to spend, minus money out); Spent, Income and Net keep excluding transfers.
- **Variable regular payments** (a salary that changes a little every month): the fix is not detection with wider tolerance but **Track as regular payment**, a confirmed item following every payment with the same label key whatever the amount, expecting the median of the last 6 ("about €2,850"). Chosen over widening ±10% for income because it also covers bonus months and stays under the user's control. The earlier idea of splitting payments renamed to one merchant was dropped: not the problem reported.
- **Home drill-down keeps the scroll** with a `scroll={false}` navigation (tried against a client-side drill-down: no skeleton flash, Back restores the position, less code). `?account=all` shows all accounts over a default Home account, which is set from an account's ⋯ menu ("Set as default").
- **Default Home account** is stored on `users`; `?account=` still wins, and All accounts stays one tap away.
- **Real data**: every migration in Slices 50–53 only adds nullable or defaulted columns; existing categories, assignments, rules, synced rows and regular payments keep their meaning.

## 67. Resolved decisions (Slice 52)

Jérémy's answers while planning (`/mnt/project-files/plans/slice-52-savings.md`).

- **Account type, not a manual account** (supersedes the §66 "manual account" idea): each account is Current (default) or Savings, set in the account sheet. Account creation is unchanged.
- **No imports or bank link on a Savings account**: Jérémy doesn't import his Livret A and it can't sync. Switching to Savings is refused if the account has imports or a link, or is the only Current account; switching back is refused while it holds franC-created rows. Switching to Savings turns "Count in safe to spend" off.
- **Move to savings** creates the counterpart row on the chosen Savings account (`source = 'franc'`, `created_from_id`, one hidden `imports.kind = 'franc'` per account) and links the pair as a confirmed transfer. Unlinking such a pair deletes the created row and stores no rejection.
- **Savings rule moves past rows too**: the checkbox "Also move past and future payments like this" creates a `savings_rules` row and moves all existing matches at once; later rows move after imports and syncs. Rules are separate from category rules.
- **Saved** = transfer pairs with exactly one leg on a Savings account (+ into, − out), dated on the Current leg. Home shows it only when a Savings account exists (2 × 2 on a phone, 4 columns from `md`).
- **Year table**: the old "Saved" column (income − spent) is renamed **Net**; a new **Saved** column appears only with a Savings account. The "You saved €X" sentences keep meaning income − spent.
- **Recurring detection keeps the Current-account leg** of a transfer to a Savings account. Otherwise the refresh would delete a confirmed "VIR LIVRET A" item with no rows left. This also fixes the §38 known limit.
- **Migration `0032_savings` is additive only** (enum values, defaulted columns, new table); real data keeps its meaning.

## 68. Resolved decisions (Slice 53)

Defaults chosen while planning (`/mnt/project-files/plans/slice-53-variable-regular-payments.md`).

- **`recurring.source`** (`detected` | `manual`): a tracked item is `manual`. It is always confirmed while running; Dismiss, Mark ended, Resume and Restore keep working and keep it tracked.
- **Expected amount** = lower median of the newest 6 payments (same median as detection, integer, errs low). Cadence = band of the median gap between them, else the stored interval (monthly at creation). Shown "about +€2,850" in whole euros on Regular payments, the item sheet, Next month and Coming up; safe to spend's breakdown stays to the cent.
- **No price alerts** on tracked items. Detection never matches, reshapes or deletes them; only an item with no payment left is deleted.
- **Track on an existing key** converts that item (any status) instead of adding a second one; Undo restores its previous status.
- **Stop tracking** returns the item to detection (`detected`): it stays "To confirm" if detectable, else disappears.
- **Real data**: migration `0033_tracked_recurring` only adds an enum and a defaulted column; existing items keep status, alerts and links.

## 69. Resolved decisions (Slice 54)

Defaults chosen while planning (`/mnt/project-files/plans/slice-54-create-category-in-picker.md`).

- **Same form and action as Settings** (`CategoryForm`, `createCategoryAction`): one validation, one set of messages; the action also returns the new category so the pick does not wait for the refresh.
- **Create row** only when no category name equals the search after folding accents and case ("Uncategorized" included).
- **Defaults**: top level and next free colour; the one parent whose subcategories are the only matches is pre-selected, with a shade of its colour.
- **Failure** shows inline in the form (retry by pressing the button again); the apply step is a normal pick (toast with Undo; Undo keeps the new category).
- **Bulk edit** uses native selects, so each gets a last option "New category…" opening the same form in a sheet; the created category applies to the selection.
- **Real data**: no migration; existing categories, assignments, rules and synced rows are untouched.

## 70. Open questions

- [x] Exact bank CSV columns, delimiter, and date/amount format: resolved via the sample export (synthetic) in `docs/samples/sample-export.csv` — `;`-delimited, `DD/MM/YYYY` dates, comma decimals, separate `Debit`/`Credit` columns (not a single signed amount). See `docs/samples/README.md` for the full column list.
- [x] Default categories: none since Slice 14 (§27). Until then 15 were seeded (Groceries, Dining out, …); existing users keep them as regular categories. Sign-up still creates one default bank account, "Main account" or "Compte principal" by sign-up language (§50).
- [x] Hosting choice: **Vercel (Hobby) + Neon Postgres (EU region)**. Both free tiers cover this project's scale. Data sits with US-headquartered companies under a DPA/EU SCCs rather than EU-only infrastructure — accepted trade-off for lower ops burden on a personal project.
- [x] Single account or multiple accounts in v1 UI: multiple, since Slice 15 (§28).

## 70. Resolved decisions (Slice 55)

Jérémy's idea: assign money to a specific goal, like YNAB (`/mnt/project-files/plans/slice-55-goal-money.md`).

- **One ledger.** A goal holds the sum of its `savings_goal_contributions`. An entry is money added by hand (goal tracked by hand), an assignment from Not assigned (`transaction_id` null) or a moved row (`transaction_id` = the row on the goal's account, cascade).
- **Several goals share one account** (the one-goal-per-account index is dropped). **Not assigned** = account balance − what its goals hold; it may go negative when the balance falls (shown, never blocked). A new account goal starts at €0.
- **Migration `0034_goal_money` keeps every saved amount**: each existing account goal gets one entry equal to its account's balance on the migration day (clamped to 0 … 10 000 000 €, same rules as `getAccountBalances`). Manual goals are untouched. Only rows are added; categories, rules, synced rows and transfers are untouched.
- **Move to savings picks a goal in one tap**; the account button itself means Not assigned. Money out of savings needs a goal that holds enough. A savings rule can carry a goal (`savings_rules.goal_id`, set null on goal delete), for money in only. The goal of an existing move can be changed in the transfer section.
- **Limits**: assigning ≤ Not assigned (and needs a starting balance); unassigning, taking out, moving between goals, removing an entry never leave a goal below €0.
- **Changing a goal's account** only while it holds €0 (its zero-sum entries are dropped and its rules cleared).
- **Deleting an account** keeps its goals' money (their entries lose `transaction_id`; the goals become manual).
- **Undo**: undoing a move removes its entry and Undo of that moves again with the same goal; deleting a goal and Undo restores its entries whose row still sits on the account, and re-links its rules.
- Safe to spend, Saved (Home, Year), the projection and transfer detection are unchanged.

## 71. Resolved decisions (Slice 56)

Jérémy's question (2026-10-06): how to count cash and the Swile meal card. Plan: `/mnt/project-files/plans/slice-56-manual-transactions.md`.

- **Cash needs nothing new**: the ATM withdrawal comes from the bank; categorize it or split it.
- **Swile can't be synced**: meal-voucher cards fall under the PSD2 limited-network exemption, no aggregator offers Swile (searched 2026-10-06), and its CSV exports are for employers only. Scripting its private app API was rejected (stores the password, breaks with each app change).
- **Manual entry, on any Current account** (supersedes "there is no manual entry"): Jérémy preferred one feature for every account over a meal-card account type. Savings accounts keep Move to savings only.
- **No setting or new account type**: a row added by hand waits for the bank (`transactions.awaiting_bank`) when its account was fed (bank link or a CSV/sync import) at creation; otherwise it is final. A third account type would have meant converting `accounts.savings` on real data.
- **Adoption**: an incoming CSV or synced row that would be inserted takes over a waiting row of the same amount within ±3 days (one candidate, or one on the same date). The row is updated in place: the bank's date, label and identity; the user's category, note, tags, splits and links. Other-side matches (§60) come first.
- **Not found** after 7 days: Review section and Needs attention row; Keep, Delete or Same as… (link to a bank row within ±7 days).
- **Edit and Delete** only on rows added by hand; Ignore is not offered on them.
- **Real data**: migration `0035_manual_transactions` adds the enum value `manual` and a defaulted column; existing rows keep their meaning.
- **Built differently from the plan** (2026-10-06): Same as… is refused for a hand row that is a transfer leg, because deleting it would cascade-delete the Savings row created with it. Same as… lists bank rows with the same sign and a ±7 day window, not "any amount". Rows added by hand are left out of the newest-transaction-date used for the first sync window, so a lunch dated today can't start the first sync today.

## 72. Resolved decisions (Slice 57)

Jérémy's brief (2026-10-06/07): Home as a short summary of the accounts today, in a look nearer the franc banknotes. Plan: `/mnt/project-files/plans/slice-57-home-50f.md`; brief: `home-redesign-brief.md`.

- **Look**: the last 50 F note (Saint-Exupéry, 1993): night-blue dark theme, periwinkle accent, sand hero amount, amber for warnings, faint guilloché rosettes and a "50" on the hero. Manrope (text and numbers), Cormorant Garamond (hero amount only), Cinzel (titles), all self-hosted. Three new dependencies: `@fontsource-variable/manrope`, `@fontsource-variable/cinzel`, `@fontsource/cormorant-garamond`.
- **Scope**: Home first. The look lives in one class, `.theme-50f`, forced dark, applied to Home and to the bottom bar and sidebar while on Home. Other pages keep Tricolore and the theme setting until a roll-out slice; this look is meant to become the only theme (variants in the other last-series note colours may follow).
- **Red is never used** inside `.theme-50f`: `--destructive` maps to amber.
- **Home sections**: Reste à vivre, À traiter, Comptes, Budgets, Objectifs. No search params; no actions, only links.
- **The month views moved** to `/month` ("Ce mois-ci", Plan tab), unchanged: switcher, account filter, totals, budgets of the month, categories, trend, Balance card with its chart, Coming up. `dashboardHref` builds `/month?…`. The default account applies there; Home always counts every account.
- **Francs**: 1 € = 6,55957 F, the legal rate, rounded to whole francs by integer maths, shown muted under the hero amount. **No inflation adjustment** (Jérémy, 2026-10-07: "keep the plain legal rate for now").
- **Hero chart**: cumulative spending of the month over the accounts counted in safe to spend (transfers excluded), against a dashed even pace from 0 to spent so far plus what is left.
- **À traiter**: first 3 rows, "See all (N)" expands in place; a price rise shows the old price struck through and the new one in amber.
- **Budgets and Goals on Home**: top 4 each, ten-block gauges (a half block from 5 %), the budgets with today's pace tick; the budget order is the existing overview's (over, then ahead of pace, then most used).

## 73. Resolved decisions (Slice 58)

Jérémy's brief (2026-10-07): Direction A "La liste qui valide" for Transactions and its detail sheet, in the 50 F look. Plan: `/mnt/project-files/plans/slice-58-transactions-50f.md`; mockups on the shared artifact page.

- **A. Validation needs a destination.** A row can be validated only if it has a category, a split, a confirmed transfer, or is ignored (`hasDestination`, `lib/transactions/validation.ts`; the same rule in SQL in `queries/review.ts`). Assigning a category by hand validates the row (`reviewed_at = now()`), including a manual entry created with a category.
- **B.** Removing a category sends the row back to review.
- **C.** Bulk validate, "Mark all" and R skip rows without a destination and say how many stayed.
- **D.** Swipe right on the list means validate; on a row that cannot be validated it opens the category picker. The ✓ button shows only when the row can be validated.
- **E.** `/review` stays as a second way in, with rule A (the big button becomes "Choose a category" on a bare row).
- **F.** Quick preset chips are removed; every active filter is a wrapping removable chip. The sideways-scrolling chip row is gone.
- **G.** New `review=todo` filter; the "N to review" row filters the list instead of opening `/review`.
- **H.** The sheet amount is large sans serif. Francs and Cormorant Garamond stay on Home's hero only (Jérémy, 2026-10-07, after review).
- **I.** Up to 4 suggestion pills (same merchant, same label key, most used in 90 days, most used overall, then the first categories) plus "+ New", which opens the existing category-creation form; the category picker also has a visible "New category" button.
- **J–K.** Note and tags sit below the category; Ignore and Delete live in their own amber card.
- **L.** The bulk bar covers the tab bar while selecting.
- **M.** The 50 F look now covers `/transactions` and `/review` (page, sheets, bottom bar, sidebar, error toasts); other pages keep Tricolore.
- **N.** No desktop split pane. **O.** Existing production rows are untouched: no migration.
- **P.** Creating a category from the picker reuses `NewCategoryForm` / `CategoryForm`, the same component as Settings.

## 74. Resolved decisions (Slice 59)

Jérémy's brief (2026-10-07): merge Budget and Ce mois-ci into one page that can analyse any month, in the 50 F look, direction A6 "Relevé · mélange" (order of A2, month card from the Copilot-like D, ring "Où est passé l'argent" from A4), with the month name opening a month grid. Plan: `/mnt/project-files/plans/slice-59-budget-month-50f.md`; mockups on the shared artifact page.

- **A. One page at `/budget`** with `?month=YYYY-MM` and `?category=<id>`. The old `/plan` and `/month` are deleted outright, with no redirect (Jérémy: "on peut supprimer l'ancienne adresse entièrement"); Mois prochain is `/budget/next-month`. The navigation section is still called `plan`.
- **B. Order**: month card, Budgets, Où est passé l'argent, À venir (current month only), Objectifs, Solde (every month), Aller plus loin.
- **C. The Solde card stays and shows the selected month's curve**, so months can be compared (Jérémy): a past month's real end-of-day balance, rebuilt backwards from the known balance and the daily net of transactions; the current month real to the last known day, then dashed to the month's end (recurring payments minus what budgets still hold back, spread per day). A month ending before the first known transaction says there is no known balance.
- **D. The account filter is removed** from this page; everything counts all accounts, as budgets already did. `?account=` is ignored.
- **E. "Prévu"** (planned spending) of a month = every budget's available amount (never below 0) plus the month's regular payments no budget covers, already paid or still projected (fix 2026-10-15: paid ones were left out, so the current month only counted payments still due and a past month none). Budgets keep no history: a past month uses today's amounts.
- **E2. "dont X hors budget"** (Jérémy, 2026-10-12): the spent figure counts every outflow, the plan only budgets and regular payments, so the month card names the spending no budget covers and no regular payment explains, right after "sur Y prévus". The comparison itself is unchanged.
- **F. Month bars**: nine months ending four after the selected one, never past the current month, plus the next month as an outline when the window reaches the current month. Every bar links to its month.
- **G.** One dashed line at the selected month's planned amount.
- **H. Changing month**: arrows, bars, or a tap on the month name (the month grid), the last one for jumping far in one gesture.
- **I. Budgets** use Home's ten-block rows, all of them; the pace tick and "rythme rapide" only for the current month.
- **J. A rollover deficit is told in words**, never as a negative "sur": "{spent} dépensés · {carry} de retard reporté" (100 %), also on Home.
- **K. Verdict line** under the chart: what is left (current month) or how many budgets were kept (past month).
- **L.** A past month shows its change against the previous month.
- **M. Categories**: a ring in the categories' colours, the top 4 as rows with a bar, "Toutes les catégories (N)" for the rest.
- **N. Goals** in Home's rows, plus "Mis de côté en {mois}" when a Savings account exists.
- **O.** "Aller plus loin" keeps Recurring, Next month and Year; the "Ce mois-ci" row is gone.
- **P. 50 F scope**: `/budget` only (`isFiftyFrancsPath`); `/budget/next-month`, `/recurring`, `/year`, `/settings/budgets`, `/settings/goals` stay Tricolore.
- **Q. An empty month** says so in the card (the bars stay to jump elsewhere) and offers Import or the latest month with data; budgets and categories are hidden.
- **R.** Two columns from 1024 px. **S.** The big "dépensés" figure and the chart labels are whole euros; every other amount keeps cents.

## 75. Resolved decisions (Slice 60)

Jérémy's brief (2026-10-07): the lists he manages (Catégories, Budgets, Objectifs, Paiements récurrents) join the 50 F look. Plan: `/mnt/project-files/plans/slice-60-lists-50f.md`. Supersedes §74 P for these four pages: they are now 50 F, the rest of Plus and `/budget/next-month` stay Tricolore.

- **A. 50 F scope**: `/settings/categories`, `/settings/budgets`, `/settings/goals`, `/recurring` (and their sub-paths) join `isFiftyFrancsPath`. Each page and its `loading.tsx` get the 50 F wrapper; **every** sheet these pages open gets `className="theme-50f"`. Result: amber instead of red, and the pages no longer follow the phone's light mode. `/budget/next-month`, `/year`, the rest of Plus stay Tricolore.
- **B. Page header**: `PageHeader` with its back arrow (unchanged hrefs) and the Budget page title style (Cinzel 22 px, uppercase). The header ＋ `AddButton` is **removed** from these pages.
- **C. Add button**: New `BottomAddButton` (§4.1): full-width periwinkle button, sticky at the bottom of the content above the tab bar, same `href="?add=1"` and the same accessible name as the visible text. Used on Catégories ("Nouvelle catégorie"), Budgets ("Ajouter un budget"), Objectifs ("Nouvel objectif"). Hidden when the page shows its empty state (the empty state keeps its own add link). Paiements récurrents has none.
- **D. Categories list**: One 50 F card per top-level category: header row (32 px tile with icon/colour, name, "budget" pill when the category has a budget, this month's spending only when > 0, ⋯), then its subcategories (10 px colour dot, name, spending only when > 0, ⋯), then a "＋ Sous-catégorie" row (accessible name unchanged: "Ajouter une sous-catégorie à {name}"). A lead line under the title: "{count} catégories · dépenses du mois". The inline round ＋ button and the caption line ("N sous-catégories · 0 € ce mois-ci") are removed. Tapping a row still opens its edit sheet; ⋯ menu unchanged. No folding.
- **E. Category colour field**: 12 swatches from `CATEGORY_PALETTE` (6 per row, radio buttons, a small dot on swatches already used by another category), then "Ou une couleur exacte": live swatch, the hex text input (the submitted field, as today) and the native picker as a "Nuancier" button. Picking a swatch writes its hex into the text field; typing a hex that matches a swatch selects it. The "Déjà utilisée par …" / hex hint stays. Shared form, so the transaction picker's "+ Nouvelle catégorie" gets it too.
- **F. Category parent field**: Radio pills instead of the native select: "Premier niveau" then every top-level category (wrapping, no "…"). Same `parentId` form field (a hidden input carries the value); locked state (category with subcategories) shows the pills disabled plus the existing hint.
- **G. Budgets list**: Header card: "**{total}** prévus par mois · {n} budgets" + the existing gauge legend (`dashboard.budgets.legend`, "1 carré = 10 %", day and pace). Then section "Ce mois-ci" with rows identical to the Budget page rows (tile, name, `BudgetDetailText`, amber "dépassé de …" / "rythme rapide", big %, `BlockGauge` with pace tick) plus the ⋯ menu (Modifier, Voir les opérations, Supprimer le budget). Tapping the row opens the edit sheet (accessible name unchanged: "Modifier le budget de {name}"). Subcategory budgets are indented under their parent (**no** coloured left border). A budget with rollover and no carry adds " · Reste reporté" to its detail line. Footnote: "Le budget d'une catégorie couvre aussi ses sous-catégories. Touchez un budget pour le modifier." The old "Il reste … pour N jours" sentence goes (the header card replaces it).
- **H. Budget sheet**: Unchanged fields. Presets: hide "Mois dernier" when it equals the average once rounded to the euro. Carry line ("{amount} de dépassement reporté sur ce mois") in amber. "Supprimer le budget" as an amber text button (no red).
- **I. Goals list**: Intro shortened to one sentence. Header card: "**{saved}** mis de côté sur {target}" (sum of all goals), sand `BlockGauge` of the sum, and "{amount} par mois à mettre de côté pour tenir les dates" (sum of `monthlyCents` of dated goals that are on track or behind; line hidden when 0). Then, when some goals use an account, the existing "not assigned" lines (same keys and `data-testid="not-assigned"`) inside a card titled "Argent restant à affecter". Then section "Vos objectifs": rows like Home's goal rows (emoji tile, name, detail line, sand gauge, big % replaced by a ＋ button) and the ⋯ menu unchanged. Detail line: "{saved} sur {target} · {source} · {when}" where source = account name, or "à la main"; when = "juin 2027" (month label, lower case in the sentence) or "sans date"; then " · en retard de X" (amber) when behind, " · échéance dépassée, reste X" (amber, was red) when past due, " · atteint" (mint) when reached.
- **J. Goal ＋ button**: 44 px button on each row. Manual goal: opens the "Ajouter de l'argent à {name}" sheet. Account goal: opens "Affecter de l'argent à {name}". Accessible names are those titles. Tapping the row still opens the edit sheet; take out / unassign / move stay in ⋯ and also as a text link at the bottom of the add/assign sheet ("Retirer de l'argent" or "Désaffecter de l'argent", which switches the same sheet to that direction).
- **K. Contribution presets**: Pills above the amount field fill it: manual goal: "{monthly} · pour tenir la date" (when the goal has a date and `monthlyCents > 0`), "{remaining} · pour finir" (when `remainingCents > 0`). Account goal, assign direction: the same two plus "Tout · {notAssigned}" when `notAssignedCents > 0`. Remove direction: no pills. Amounts in cents, displayed with `formatCents`. Pure helper `contributionPresets` (§3).
- **L. Goal form**: Fields: Nom, Icône, Montant à atteindre, Date (facultative), then "D'où vient l'argent": a two-option segmented radio "Argent ajouté à la main" / "Sur un compte" (the second only when the user has accounts), and, when "Sur un compte", radio pills with each account name. The submitted `source` field stays `manual` or the account id (hidden input). Help line under it: manual "Vous ajoutez l'argent vous-même avec ＋." / account: existing `sourceHelpAccount`. Edit sheet adds "Supprimer l'objectif" as an amber text button at the bottom (same delete + Undo as the ⋯ item). Errors in `text-warning`.
- **M. Recurring headline**: Card: "**{monthly}** par mois confirmés" (confirmed outflows only), then "{yearly} par an · {n} paiements" and, when there are confirmed inflows, " · revenus +{income} par mois". No outflow confirmed: existing "Aucune facture ni aucun abonnement trouvé pour le moment". The detected amount no longer counts in the headline; it moves to the À confirmer block.
- **N. "À confirmer" block (version B)**: Shown when at least one detected item (after the category filter). Section title "À confirmer". **Card mode** (default): "{i} sur {n} · {amount} par mois au total" + a "Voir la liste" link; the first detected item: tile (category icon/colour, else the letter avatar), name, category · caption (`caption.next`), big amount (`ExpectedAmount`), "par mois · {yearly} par an", the last 4 charges as small tiles (amount, short month), then two 52 px buttons **Ignorer** / **Confirmer**. Swipe right confirms, left ignores (same `useRowSwipe`). Tapping the card body opens the item sheet. After an action the next detected item shows; Undo toast as today. **List mode**: title "{n} paiements trouvés" + "Un par un" link, the question "Ils reviennent chaque mois. Les garder dans vos prévisions ?", rows (name, caption, amount, ✕ 44 px, ✓ 44 px; tap = sheet; swipes kept), the first 5 then "Voir les {n} autres" (expands in place), and "Tout confirmer" in the footer. The chosen mode is kept in `localStorage` key `franc:recurring-to-confirm-view` (`"card"`/`"list"`, try/catch, default card). Order of items: detected bills then detected income, each in `splitSections` order. The block disappears when nothing is left to confirm.
- **O. Confirmed lists**: "Factures et abonnements" and "Revenus" now hold **confirmed items only** (detected ones are in the block). The bills title gets a "Trier" link that opens the filters sheet (§P). Rows: category tile (or letter avatar), name, caption, amount; no "À confirmer" pill. Swipe left still ignores a confirmed item. "Terminés" and "Ignorés" stay as folded cards at the end.
- **P. Sort and category filter**: The chip row (`RecurringChips`, cycling sort chip) is replaced by one sheet "Trier et filtrer" opened by "Trier": group "Trier par" (Prochaine date, Coût par an) and group "Catégorie" (Toutes, Non catégorisée when used, the categories). Picking an option navigates with `recurringHref` as today and closes the sheet. When a category filter is on, "Trier" reads "Trier · {catégorie}".
- **Q. Price rise caption**: Row caption for an open price alert: old amount struck through (muted) then new amount in amber, like Home ("66,50 € 69,90 €"), replacing "Hausse de prix · +3,40 €".
- **R. Swipe hint**: Kept, restyled by the theme (no code change beyond the wrapper).
- **S. Desktop**: Same single column as today (`max-w-2xl`); the bottom add button is sticky at `lg:bottom-6` (no bottom bar there). No two-column layout in this slice.
- **T. Not done (say so in the PR)**: Goals account card with balance + gauge (mockup round 2): the existing "not assigned" lines are kept instead, since balances are not loaded on this page. Collapsing the confirmed list to 4 rows: not done, the full list stays.

## 76. Resolved decisions (Slice 61)

Jérémy's brief (2026-10-08): critique of the bar and Plus, then: no Import button for anyone, same bar for every account, theme picker gone, Accounts as a tab, accounts card off Home, addresses may change, no redirects. Plan: `/mnt/project-files/plans/slice-61-nav-accounts-more.md`. Supersedes the raised Import button of §65 and §49, the theme setting (around §397) and the "URLs unchanged" rule of §51 for Accounts and Bank connection.

- **A. Sections**: `home`, `transactions`, `plan`, `accounts`, `more`; the `import` section is removed. One order for bar and sidebar (`TAB_SECTIONS`).
- **B. Active section**: `/accounts` (with `/accounts/bank`) and `/import` are Accounts; `/settings…` stays More.
- **C. Bar and sidebar**: five equal tabs for everyone, no raised button, no `showImport`; icons House, List, ChartPie, Landmark, Ellipsis; badge text 11 px. Wordmark C in sand, no red.
- **D. One dark theme**: the picker, the `theme` cookie and `lib/theme/*` are removed; `<html>` is always `dark`; theme colour `#04051a`. `users.theme` stays unused (no migration).
- **E. 50 F scope**: every page except `/budget/next-month` and `/year`; the pages that only got the token switch (rules, merchants, tags, bank categories, export, import, bank connection) are not redesigned.
- **F. Plus**: Sorting (Categories, Rules, Merchant names, Tags, Bank categories, with counts), Your data (Export), Preferences (Language in a sheet), franC account (email, Sign out). No hints, one column.
- **G. Accounts tab**: total card, Your accounts (tile, caption, balance), Bank sync (one card per connection with status, validity and Sync now; Manage leads to `/accounts/bank`), Imports (Import a CSV, overdue accounts in amber, reminder switch), Add account at the bottom.
- **H. Home**: the accounts card is removed. The safe-to-spend prompt shows whenever no counted account has a balance. Account warnings stay in "À traiter".
- **I. Addresses**: `/accounts` and `/accounts/bank` replace `/settings/accounts` and `/settings/bank-connection`; no redirects, the old routes answer 404. The Enable Banking callback `/api/bank-sync/callback` and `/import` are unchanged.
- **J. Not done**: no redesign of the import and bank connection pages beyond tokens and back arrow; `/budget/next-month` and `/year` stay in the older palette (always dark).

## 77. Resolved decisions (Slice 62)

Jérémy's brief (2026-10-12): critique of Import, Bank connection and first run, then answers: the preview shows money in/out/net; one "sync from" date per bank; the first run offers the bank first (owner only). Plan: `/mnt/project-files/plans/slice-62-import-bank-firstrun-50f.md`. Supersedes "J. Not done" of §76 for these pages.

- **A. Import screen**: account pills (several accounts), file card with the help inside, preview card (file, account, period, N new, In / Out / Net, duplicates as one faded line, unreadable lines in amber with See which), bank categories as pills plus a Choose sheet, 4-row operations sample with See all, bottom bar with Import N / Cancel (Choose another file when nothing is new).
- **B. Money in the preview**: `cashFlows(plan.fresh)`; in = sum of positives, out = sum of negatives, net = in + out, integer cents.
- **C. Result screen**: card, To do (Validate all for a first or 50+ import, else Review N; transfers and price alerts), Found in this file, Import another file, Undo this import. An import with no new row is recorded only through "Record this import anyway" (merges and backfills still need the commit).
- **D. History**: one ⋯ menu per import with Undo import (confirmation); sync runs without a menu; dates in the app's short format.
- **E. Bank page**: titled "Bank"; empty card with three facts, Without sync row, Choose my bank at the bottom; link step with a sheet per bank account and one shared date (earliest default; the user's edit sticks); Save and sync starts the first sync; connected card with ⋯ (Change links, Disconnect bank), balances and a full-width Sync now.
- **F. First run**: steps bank (if `BANK_SYNC_EMAILS` allows) or import, balance, review, budget; gauge; "Hide this guide" below the card.
- **G. Not done**: no change to dedupe, sync, undo or the bank callback; no new transaction filter from the history; no desktop-specific layout; DESIGN.md refresh is a follow-up.

## 78. Resolved decisions (Slice 63)

Jérémy's brief (2026-10-12): the last two Tricolore pages, Next month and Year, move to the 50 F look. He chose "What's left" for Next month and mini bars for the year's categories, and asked for 50 F loading skeletons too. Critique 23/40 and 25/40 in `/mnt/project-files/critique/next-month-year-2026-10-12/`, plan `/mnt/project-files/plans/slice-63-next-month-year-50f.md`. Supersedes §74 P and §76 J (pages left in Tricolore) and the Sankey, table and account-filter choices of §47 (Slice 33).

- **A. Every page is 50 F.** `TRICOLORE_PAGES` and `isFiftyFrancsPath` are removed; the bottom bar, sidebar and toasts always wear `theme-50f`.
- **B. No account filter** on Next month or Year (as on the Budget page, §74).
- **C. Next month, "What's left"**: income − base budgets (no carry-over, negative = 0) − regular payments outside a budgeted category (`nextMonthOutlook`, via `plannedSpendingCents`). A payment in a budgeted category is not counted twice. Amber, never red, when negative.
- **D. Next month layout**: title = the month, sections What's left, a single "N to confirm" row linking to Regular payments, Budgets, Expected payments, Expected income; detected items get an amber dot and screen-reader text, not a badge; rows link to the item; two columns from `lg`.
- **E. Budget page hint** for Next month reads "{month}: about €X left" with the same figure.
- **F. Year layout**: year bar, headline (saved + Income / Spent / Spent per month + best and toughest months), Month by month net bars (`netBarScale`, one link per month), The months list, Where the money went (the Budget ring and ranked rows, period sheet for year or one month), Where it came from, By category rows with a 12-bar sparkline.
- **G. Removed**: the Sankey and its tables, the monthly chart and table, the category × month matrix, the year selector with "This year", `month-bars-chart` and `chart-readout`. Nothing on the page scrolls sideways.
- **H. Colours**: positive months soft blue, best month mint, negative months amber, current month hatched; no red.
- **I. Skeletons and fallbacks**: all loading skeletons, the not-found page, `ErrorFallback` and `global-error` wear the 50 F night look; `ManageListSkeleton` loses its `fiftyFrancs` option.
- Not done: no balance projection on Next month (the Budget Solde card projects the current month); no per-category month detail on Year; no Sankey on desktop.

## 79. Resolved decisions (Slice 64)

The three leftovers of Slice 60 (§75 T), plan `/mnt/project-files/plans/slice-64-lists-leftovers.md`, mockups https://claude.ai/artifact/KL9wuM2qW9kWKSL8tUrBUP.

- **A. Goals account card** replaces the "Money left to assign" lines: one card per account with goals, balance, "assigned · to assign" (amber), sand gauge. No new query.
- **B. Edge cases**: all assigned reads "all assigned"; over-assigned is amber with a full amber gauge; no balance links to Accounts.
- **C. Folded confirmed lists**: Bills and Income show 4 rows then "Show N more"; items needing a look are never folded away; the state is not persisted.
- **D. Over-budget E2E**: amber text and percentage on Settings > Budgets and Budget, no red text on those pages or Home.

## 80. Resolved decisions (Slice 65)

Jérémy's brief (2026-10-13): show on Home which recurring payments are still due this month, and above all whether a big one is still to come. He picked mockup E (one strip, dots sized by amount, 100 € and more in another colour, tap a dot to name the payment, the biggest bills listed below, under Budgets). Plan `/mnt/project-files/plans/slice-65-home-upcoming.md`, mockups https://claude.ai/artifact/9tEH93eMJpPk2XZtfk94af.

- **A. Same bills as Reste à vivre**: the card shows `safeToSpend.bills`, so its total equals the sheet's "bills still due". Income is never shown.
- **B. Only with the hero**: hidden when the Reste à vivre prompt shows instead; with no bill left it reads "Nothing left to pay this month".
- **C. Big = 100,00 € or more** (`BIG_BILL_CENTS`, inclusive), a constant, not a setting.
- **D. One dot per day**: bills of one date merge, sized by the day's total (8 to 22 px, capped at 300 €), sand if any bill of the day is big.
- **E. A tap on a dot** opens a bubble with the bills of that day and the day before and after, three lines then "+ N more".
- **F. The list** is the 3 biggest bills still due, largest first (the strip already gives the dates).
- **G. Placement**: under Budgets, before Goals. The "How is this worked out?" sheet is unchanged.
- **H. Wording**: "bills" / "factures" (glossary), not "prélèvements".
- **I. A bill dated before the month** sits on day 1 of the strip.

## 81. Resolved decisions (Slice 66)

Jérémy's brief (2026-10-14): a budget shows the regular payments of its category, paid or still expected (a 150 € gym in a 200 € budget), pre-filled in its gauge, with the pace counted on the rest, payments-only budgets hidden, and what is left to spend. He picked mockup B3 ("B3 partout"). Plan `/mnt/project-files/plans/slice-66-budget-charges.md`, mockups https://claude.ai/artifact/8FJqjeYvaHC1cJM4SvXvKS. Read-only: no schema or data change.

- **A. Charges of a budget**: outflow lines of the month linked to a regular payment (`recurring_id`), plus the bills still due this month from `safeToSpend.bills` (the "Factures à venir" of Reste à vivre). A charge belongs to the entry of its own category or of its direct parent, like spending, so a parent and its subcategory budget both count it.
- **B. Gauge**, in % of the available amount, capped at 100 % in total: payments paid (solid sand), other spending (periwinkle, amber when over or ahead of pace), payments still due (hatched sand). The big percentage stays the real spending.
- **C. Pace on the rest**: the white tick starts after the paid payments and leaves room for the due ones: `paid% + day/daysInMonth × (100 − (paid + due)%)`. Without payments it is today's tick. The "rythme rapide" test is unchanged (it already set recurring payments aside).
- **D. Detail line**: " · X à venir" in sand after "x sur y" when payments are due.
- **E. Left to spend** under the gauge, current month only, never on an over budget, on every budget (with or without payments; Jérémy 2026-10-19): `available − spent − due`. Positive: "Reste X à dépenser"; zero: "Tout est prévu : plus rien à dépenser"; negative: amber "X de trop avec les prélèvements à venir".
- **F. Payments-only budget**: payments (paid + due) cover at least 95 % of the available amount and the budget is not over (was 100 % until 2026-10-15: a 123,99 € payment in a 124 € budget must count as full). Home leaves it out. The Budget page folds it under "Voir les N budgets de prélèvements" with its total and what is still due. Budgets settings shows every budget.
- **G. Payment lines** only on the Budget page: one per charge, by date; green tick + "payé le …" or sand ring + "attendu le …", name, amount.
- **H. Past months**: paid payments only, no tick, no left-to-spend line.
- **I. Budget sheet**: a "Prélèvements X €" pill first (this month's active outflow payments of the category and its subcategories, rounded up to the euro) and a note naming up to three of them.
- **K. Budget from a regular payment** (2026-10-15): the item sheet of a running outflow with a category links to its budget. Without one: "Créer un budget <catégorie>" opens `/settings/budgets?edit=<category>&amount=<cents>`, the amount pre-filled with the payment when it is monthly. With a budget on the category or its parent: "Voir le budget <catégorie>" opens it.
- **J. Wording**: "prélèvement" for a charge of a regular payment (glossary); "factures" stays for the bills of Reste à vivre.

## 82. Resolved decisions (Slice 67)

Jérémy's brief (2026-10-14): follow loans easily, YNAB-style (a loan with a negative balance), with payments that differ from the schedule, a long interest-only period, and the split of a payment (insurance, interest, capital) correctable. Three loans, one monthly debit each, handled as separate loans.

- **A. Own tables**: `loans`, `loan_checkpoints`, `loan_payment_splits`. Nothing is written to `transactions`, so budgets, Reste à vivre, imports, sync, export and Year never see a loan and real data cannot be touched (a YNAB-style transfer on every payment was rejected for that reason).
- **B. Computed ledger**: the payments are the bank rows linked to the loan's confirmed regular payment (`recurring_id`), outflows, not ignored, on or after the start. Interest, insurance and capital are computed on read.
- **C. Split**: interest = capital owed × yearly rate ÷ 12 (round half-up), once per calendar month on its first payment; insurance fixed per month or a yearly rate on the capital owed; capital = paid − interest − insurance (may be negative). Checked against three real amortization tables (within one cent a line). The bank gives one total, so the split is an estimate that the user can overwrite per payment.
- **D. Corrections** are checkpoints ("capital owed at the start of day D"); a per-payment split overrides interest and insurance, capital is the rest. The first checkpoint is the loan's start and cannot be removed.
- **E. Deferral / smoothed loans**: `current_payment_until` keeps the latest payment until that date, then a constant annuity runs to `last_payment_on`. A rate-based insurance is part of the annuity rate.
- **F. Money and rates** in integer cents; rates in thousandths of a percent.
- **G. Placement**: a "Crédits" section on Accounts and `/accounts/loans/<id>`; loans are not accounts and stay out of "Sur vos comptes". A bank row that pays a loan shows its split in its sheet.
- **H. Out of scope**: a yearly amortization table, creating the regular payment from the loan form, loans paid from several debits.

## 83. Resolved decisions (Slice 68)

- **A. Two optional dates** on a loan: `started_on` (subscription) and `amortization_from` (first payment that repays capital; needs `started_on`). Both null = Slice 67 behavior. Nullable columns, no backfill (migration 0037).
- **B. One global estimate, never month by month** (Jérémy, 2026-10-14): the months between the capital start and the oldest synced payment are ONE estimated row. Capital is exact (borrowed − capital before the oldest real payment); interest and insurance are estimated by replaying one constant payment. Chosen over per-month estimates, which looked precise but were not.
- **C. The deferral is computed, not estimated**: capital = amount borrowed, so interest and insurance are exact. Assumes a partial deferral.
- **D. Real payments before "as of" are replayed backwards** from the capital owed, so they are exact and independent of the estimate. The capital owed today and the projection never change.
- **E. The last payment only has to follow the subscription date** when there is one (it may be on or before "as of"); otherwise it stays strictly after "as of".
- **F. Length and end**: the loan page says months in all / paid / left and the contract's last payment date; the curve spans subscription to last payment on a real time axis with a today line, vertical scale up to the amount borrowed.
- **G. No tooltip, no separate section** for the deferral's interest: one row in Payments and a "of which deferral" line in the cost card, because a tooltip needs a tap on a phone.
- **H. Out of scope**: interest capitalized during a deferral, importing an amortization table, editing the estimate, several payment amounts inside the estimated period.

## 84. Resolved decisions (Home and Budget feedback, 2026-10-16)

- **A. No budget rows in Needs attention.** "Over budget" and "ahead of pace" (current month) rows are gone from Home's "À traiter": the Budgets section below already shows both (amber gauge, "rythme rapide", "dépassé de X"), so the rows only repeated it. The gauges keep their over and fast-pace states. This supersedes the budget rows listed in §52.
- **B. On /budget, "Où est passé l'argent" comes before Budgets.** Phone order: Le mois, Où est passé l'argent, Budgets, À venir, Objectifs, Solde. From 1024 px the ring sits under the month card on the left; Budgets opens the right column.

## 86. Resolved decisions (Slice 74, CSV column mapping)

Every CSV import goes through a Columns step; the Caisse d'Épargne parser is gone. Bank sync (`convert.ts`) is untouched.

- **D1**: One mapping form for every file (variant A of the mockups), never skipped, even when the mapping is remembered: a prefill to confirm with one tap.
- **D2**: Columns are stored by **name**, not position, in `accounts.csv_mapping` (jsonb) with `csv_mapping_saved_at`. Reason: banks reorder columns; names survive.
- **D3**: Prefill order: this account's saved mapping; else the latest saved on any of the user's accounts (adopted as a whole when its date, label and amount columns exist in the file); else a header-name guess (French and English names). Deviation from the plan: `prefillMapping` returns `{draft, remembered}` so the UI can say which one it used.
- **D4**: A mapping is saved only when the preview reads at least one valid row.
- **D5**: Date formats offered: `DD/MM/YYYY`, `DD/MM/YY`, `DD-MM-YYYY`, `DD.MM.YYYY`, `YYYY-MM-DD`, `MM/DD/YYYY`; decimal mark comma or dot. Both are guessed from values and re-guessed when the column changes.
- **D6**: Amount is one signed column or a debit and credit column (sign from the column).
- **D7**: Header = first row with the file's usual cell count (at least 2 non-empty), so preambles are skipped. Fewer than 2 columns or no data row: "no table".
- **D8**: Encoding: UTF-8 if valid, else Windows-1252. No other detection.
- **D9**: Dedupe hash and label normalization stay frozen; a golden test (`golden.test.ts`) proves the sample export yields identical rows and hashes, so production data keeps deduplicating. No data migration beyond two new columns.
- **D10**: Still out of scope: OFX/QIF and other file types, a per-bank dropdown, multi-currency.
