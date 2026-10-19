# CSV import

Transactions come in by uploading a CSV export from any bank: you tell franC once which column is which, and it remembers. Uploading the same file twice, or overlapping exports, never creates duplicates.

## Using it

**Import** (`/import`):

1. **Choose the CSV file** (Slice 62): a card with a file icon, "Choose the CSV file" and "Your bank's transaction export" (a hidden file input inside a `<label>`, so keyboard and screen readers still work; drag and drop from `md`). Choosing or dropping a `.csv` file (max 2 MB) **starts reading it at once**, with "Reading export.csv…" meanwhile; there is no Preview button. With several accounts, a **Which account** row of pills sits above (the account of your last import is preselected, unless `?account=<id>` from the [import reminder](import-reminder.md) names another of yours); with one account there is no picker. "Where do I find this file?" folds out inside the card. A file picked before the page finished loading is picked up and previewed too.
2. **Match the columns** (Slice 74), every time, for every bank. A form shows the file (name, "140 rows · 13 columns") and a pill: **Last import's settings** when franC filled it in from a remembered mapping, **New file format** when it guessed from the header names. **Columns** card: **Date**, **Label** (a hint warns when the chosen column holds many duplicate values), and **Amount** as **One column** (signed) or **Debit and credit** (two columns, the sign comes from the column). **Format** card: how **Dates** are written (`DD/MM/YYYY`, `DD/MM/YY`, `DD-MM-YYYY`, `DD.MM.YYYY`, `YYYY-MM-DD`, `MM/DD/YYYY`) and which mark the **Amounts** use as decimal (comma or dot). A fold **Other columns** holds optional ones: short label, booking date, bank category and subcategory. **First row** shows how the first data row reads with these settings; when its date cannot be read, an amber card quotes it, says how many rows would be refused and offers **Use <format>** when another format reads it. Picking a date or amount column re-guesses its format from the file. **Continue** goes to the preview, **Cancel** back to the file card. The screen never skips: a remembered mapping is a prefill you confirm with one tap.
3. **Preview**, one card first: file name and account, the period ("2 Sept → 29 Sept 2025"), **120 new transactions** and the money they carry, **In / Out / Net** (`cashFlows`, `src/lib/import/plan.ts`; positive amounts in mint). Duplicates are one faded line ("35 already in franC, left out"; zero is never shown), unreadable lines an amber note with **See which** (line number and reason, never dropped silently). On an account fed by a [bank sync](bank-sync.md), rows the sync already brought in count as **duplicates** even when the bank worded them differently (same amount, within 3 days), and rows that could be one of several synced rows show "1 possible duplicate — you'll check them in Review" (`data-testid="import-possible"`); possible rows are included in the new count. When nothing is new the card says **Nothing new** and the main button becomes **Choose another file**; when the file still holds duplicates, a small **Record this import anyway** keeps the old commit (it merges rows into hand-entered or synced ones and backfills bank categories). **Bank categories** you don't have yet are preselected to **Create** (a plan suggestion, such as an existing category of the same name, is kept): a "27 bank categories" section shows the first names as pills, and **Choose** opens a sheet with the per-category Create / Map to / Ignore list and Create all (see [Categorization](categorization.md)). A **Transactions** section shows the first 4 new rows (merchant names), **See all 120** unfolds the first 50. A **Columns** row in the summary names the columns read, with **Change** to go back to the form. **Import 120 transactions** and **Cancel** stay at the bottom of the screen on a phone.
4. **Confirm** inserts the new rows. The result screen leads with a card ("465 transactions imported", the period); **To do** holds the next action: after a **first import** (no transaction before it) or one of **50 or more** new rows, a single **Validate all** block (franC suggests a category from your past choices, then validates everything; the rows it can't guess stay to validate; see [Review queue](review-queue.md#after-a-big-import)) with **Review one by one** as the alternative; otherwise a **Review the 12 new transactions** button. Transfer pairs found and price alerts raised are lines of the same section. **Found in this file** reports inserted, skipped and unreadable rows, backfilled bank categories and rows guessed. **Import another file** starts over; **Undo this import** (with confirmation) removes the import you just made. An import that finds nothing new is no longer recorded unless you choose **Record this import anyway**.

**Where to start an import**: **Accounts > Imports > Import a CSV**, or the Import links of the overdue-import warnings (Home and Accounts), which preselect the account. The bar has no Import button (Slice 61).

**Sharing a file to franC** (Android, installed app): franC appears in the share sheet for CSV files, so an export can go straight from the bank app or Files to the import preview. See [PWA and offline](pwa-offline.md#share-target).

**Import history** (same page, "Import history" section) lists the latest 50 imports, newest first: file name, date (like the rest of the app, "12 Oct 11:50"), the account (with several accounts) and "99 transactions" or "nothing new" (+ "· 2 unreadable"). The **⋯** menu of an import has **Undo import** (with confirmation, one destructive item), which removes that import's transactions. Bank sync runs are listed too, as **Synced from <bank>**, without a menu (see [Bank sync](bank-sync.md)); when the chosen account is linked to a bank, a **Connected to <bank>** card with **Sync now** sits above the file card. It adds "This account syncs automatically. Import a CSV for older history or a gap." so you know a CSV is only needed for dates the sync did not cover.

## How it works

### Columns and mapping

Any CSV with a header row and at least a date, a label and an amount works (`src/lib/import/`):

- **Reading the table** (`table.ts`): UTF-8 first, Windows-1252 when the bytes are not valid UTF-8 (every byte maps, so decoding never fails). A leading BOM is stripped. Papa Parse detects the delimiter. The header is the first row with the file's usual number of cells (at least 2 non-empty), so bank preambles above it are skipped; blank lines keep their line numbers. A file with fewer than 2 columns or no data row is refused ("no table").
- **The mapping** (`mapping.ts`, `CsvMapping`): the **names** of the date, label and amount columns (one signed column, or a debit and a credit column), optional short label, booking date, bank category and subcategory columns, the date format and the decimal mark. Columns are stored by name, not position, so a bank adding a column does not break it. A column that is missing from a later file is reported ("column missing") and the form opens for a fix.
- **Prefill, in this order**: the mapping last used on this account; else the latest one saved on any of your accounts, when its date, label and amount columns exist in the file (adopted as a whole); else a guess from the header names (`guessMapping`: French and English names) with the date format and decimal mark guessed from the values (`guessDateFormat`, `guessDecimal`).
- **Remembered** (`accounts.csv_mapping`, `csv_mapping_saved_at`, query `src/db/queries/csv-mapping.ts`, scoped by `user_id`): saved when a preview reads at least one valid row, so a wrong mapping that reads nothing never replaces a good one. The stored JSON is re-validated on load; invalid is treated as none.
- **Dates and amounts** (`date.ts`, `amount.ts`): one chosen format per file; single-digit days and months are accepted, `DD/MM/YY` reads as 20YY, impossible days are refused. Amounts drop `€`, `EUR` and spaces; the other mark only counts as thousands groups of three digits; more than two decimals is refused. A debit/credit pair needs exactly one real value (a zero beside a value is ignored); the sign comes from the column. Parsing uses string arithmetic, never floats.
- **Bank sync is separate**: `src/lib/bank-sync/convert.ts` is untouched and keeps its Caisse d'Épargne label cleanup for synced rows.

The example file `docs/samples/sample-export.csv` (synthetic, `pnpm sample:generate`) has this shape: `;`-delimited, `DD/MM/YYYY`, comma decimals, separate `Debit` / `Credit` columns, bank categories. Its header names are guessed as they are, and `src/lib/import/golden.test.ts` proves it still produces the exact rows and dedupe hashes the old fixed-format parser did, so existing data keeps deduplicating.

Stored fields:

| Column (mapping) | Stored as |
| --- | --- |
| date | `transactions.date` (SQL `date`) |
| label | `label_raw`, and `label_normalized` (NFKD, accents stripped, uppercase, whitespace collapsed) |
| short label | `label_display` (falls back to the label) |
| amount, or debit and credit | `amount_cents` (integer) |
| bank category / subcategory | `bank_category` / `bank_subcategory`; "A categoriser" placeholders count as none |

### Validation

Every row is validated with Zod against the mapping. Invalid rows are shown in the preview with their line number and error codes (translated in the UI); they are never silently dropped, and never inserted.

### Duplicate prevention

- `dedupe_hash` = SHA-256 of `[accountId, date, amountCents, labelNormalized]`.
- `occurrence_index` numbers identical hashes within a file (0, 1, 2…), so two identical coffees on the same day are both kept.
- A row is a duplicate if its `(hash, index)` already exists for the account. A **DB unique constraint** on `(account_id, dedupe_hash, occurrence_index)` is the final judge: inserts use `ON CONFLICT DO NOTHING`, and duplicates = valid rows − inserted.
- On an account that also has synced rows (or CSV rows, for a sync), a **matcher** goes further than the hash: the same amount within ±3 days of one row from the other side is merged into it (nothing inserted, the existing row keeps its category, note, tags and splits); several candidates are inserted as a **possible duplicate** to settle in [Review](review-queue.md#possible-duplicates). The merge is remembered in `transaction_matches`, so re-importing the file inserts nothing. Rules and the order of checks are in [Bank sync](bank-sync.md#how-it-works).
- Label normalization is **frozen**: changing it would change every hash and require a re-hash migration.

### Preview → confirm is stateless

Nothing is staged on the server. The browser keeps the file and the mapping; the Columns step, `previewImport` and `confirmImport` each re-validate, check account ownership, decode and re-parse (the mapping travels as a JSON field, at most 4000 characters, validated by Zod). Confirm is authoritative and reports its own counts; the bank-category plan is re-derived from the file, never trusted from the client.

### What confirm does (one DB transaction)

`commitImport` (`src/db/queries/imports.ts`):

1. Re-checks that the account belongs to the user, and inserts the `imports` row.
2. Creates the bank-derived categories you chose to create and stores bank category mappings.
3. Runs the matcher (`planMatches`, shared with the preview, read-only) against the account's existing rows near the file's dates. Merged rows are not inserted: their identity is written to `transaction_matches` (`ON CONFLICT DO NOTHING`) and they count as duplicates. Possible rows are inserted along with their `duplicate_candidates`.
4. Inserts the new transactions in chunks of 1000, with `reviewed_at = null` so they enter the [review queue](review-queue.md). Each row gets its [merchant name](merchant-names.md) first, then its category at insert time: a matching [rule](categorization.md#rules), else its bank category mapping.
5. **Backfills** bank categories on existing duplicate rows whose bank columns are empty (nothing else changes).
6. Applies bank mappings to your older uncategorized rows, so a newly mapped bank category also files past transactions.
7. [Guesses](categorization.md#category-guessing) a category for this import's rows still uncategorized.
8. Stores the counts. The screen no longer offers to record an import that inserts 0 rows (Slice 62); an older such record still shows in the history.

### After the commit

`refreshDerivedData` runs, each step in its own transaction so a failure never undoes or fails the import (it logs a fixed message only):

1. [Internal transfer](internal-transfers.md) detection over all unpaired rows.
2. [Recurring](recurring.md) detection and price alerts.

### Undo

Deletes the `imports` row; the FK cascade removes exactly the transactions it inserted, and with them their splits, transfer pairs, price alerts and review-queue entries. There is no "undone" state. An import owns only the rows it inserted, so undoing a later overlapping import leaves shared rows in place. Merges made by the import are forgotten with it (the cascade removes its `transaction_matches`), but a possible-duplicate decision already made with **Same transaction** deleted the synced row, which an Undo cannot bring back. Re-importing an undone file restores exactly its rows. Transfer and recurring detection re-run afterwards.

### Limits

File ≤ 2 MB; server actions accept bodies up to 4 MB (`experimental.serverActions.bodySizeLimit`).

A **Savings** account is not offered in the Account picker and the server refuses it (Slice 52, [accounts](accounts-and-balance.md)). Rows franC creates for Move to savings never appear in Import history.

## Rows added by hand (Slice 56)

A row in the file that matches a waiting hand row (same account, same amount, ±3 days) takes it over instead of adding a second row. The preview counts it as a duplicate ("0 new"), and it changes nothing for the rest of the flow. Details in [bank-sync.md](bank-sync.md).

## Code

- `src/lib/import/` — `table.ts` (header detection), `mapping.ts` (schema, guesses, prefill), `parse.ts` (`parseWithMapping`), `prepareImport`, `prepare-guessed.ts` (tests and fixtures), decoding, dates, amounts, label normalization, dedupe, bank category handling, preview plan
- `src/db/queries/csv-mapping.ts` — `loadMappingPrefill`, `saveMapping`
- `src/db/queries/imports.ts` — `planMatches`, `commitImport` (also used by bank sync with `kind: "sync"`, which stores `transactions.source` = `sync` and `external_id`), `undoImport` (CSV imports only), `listImports`
- `src/lib/actions/refresh-derived.ts` — post-commit transfer and recurring refresh
- `src/app/(app)/import/` — page, `import-flow.tsx`, `column-mapping.tsx`, `action-bar.tsx`, `drop-zone.tsx`, `import-summary.tsx`, `bank-categories-step.tsx`, `import-result.tsx`, `bulk-review.tsx`, `flow-totals.tsx`, `account-pills.tsx`, `operations-sample.tsx`, `shared-import-flow.tsx`, `import-history.tsx`, `undo-import-dialog.tsx`, actions
- `src/lib/categorize/bank-decisions.ts` — `withCreateDefaults` (Create preselected); `src/lib/import/plan.ts` — `dateRangeOf`, `cashFlows`, `offersBulkReview`

## Tests

`src/lib/import/golden.test.ts` (sample export gives the recorded rows and hashes), `src/lib/import/sample-export.test.ts` (the sample matches its generator), `src/lib/import/{table,mapping,parse,date,amount,decode}.test.ts` (header detection, guesses, prefill, mapped parsing, formats), `src/db/queries/csv-mapping.test.ts` (remembered mapping), `src/db/queries/imports.test.ts` (idempotent re-import, overlap, undo, backfill), `src/db/queries/bank-sync.test.ts` and `src/lib/bank-sync/match.test.ts` (CSV against synced rows), `src/lib/import/plan.test.ts` (preview counts including possible), `src/db/queries/bank-categories.test.ts`; Playwright import flow in `e2e/import.spec.ts`, column mapping in `e2e/csv-mapping.spec.ts` (foreign CSV mapped, remembered, reused on another account; unknown headers; date fix; Change columns), `e2e/bank-sync-overlap.spec.ts` (CSV on a connected account, re-import all duplicates), and the whole first run in `e2e/first-run.spec.ts`.

## Related

[Categorization](categorization.md) · [Review queue](review-queue.md) · `SPEC.md` §6, §15–17, §27, §55, §86
