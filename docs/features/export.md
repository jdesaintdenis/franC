# Export

Get all your data out as CSV files you can open in a spreadsheet.

## Using it

- **Transactions page > ⋯ > Export CSV**: every row matching the current filters.
- **More > Export** (`/settings/export`): four downloads — transactions (unfiltered), categories, rules, budgets.

Files are named `franc-<kind>-<YYYY-MM-DD>.csv`.

## How it works

- Route `GET /api/export/[kind]`: calls `requireUser()`, re-parses the filters like the Transactions page (bad params dropped), scopes every query by `user_id`, answers `text/csv; charset=utf-8` with `Cache-Control: no-store`. Nothing is logged; an error is a bare 500. The service worker never caches it.
- **Format follows your language**: French uses `;` and a decimal comma (`-66,50`); English uses `,` and a decimal point (`-66.50`). Headers and app words are translated; your data is written as is. UTF-8 with BOM, CRLF, fields quoted when needed.
- **Dates** `YYYY-MM-DD`; **amounts** signed (negative = outflow), from integer cents by string arithmetic, never through a float.
- **Formula guard**: text cells starting with `=`, `+`, `-`, `@`, tab or CR get a leading `'`, so a crafted bank label can't run as a formula. Amount cells are never prefixed.

### Files

| File | Columns |
| --- | --- |
| Transactions (oldest first) | date, account, label (display name), amount, category, subcategory, split part (`2/3`), transaction amount (split lines only), internal transfer (other account), category source (`manual`/`rule`/`bank`/`guess`), bank category, bank subcategory, bank label (raw), tags (sorted, joined with ", "), note |
| Categories | category, subcategory, colour, icon (raw stored value) |
| Rules | in priority order, as in More > Rules |
| Budgets | category, subcategory, monthly budget, rollover (yes/no) |

- A **split** transaction is one line per part, so the amount column sums to the real total. Under a category filter only matching parts are written. Each part line repeats the transaction's tags and note.
- The tag filter (`?tag=`) carries into Export CSV like the other filters.
- A subcategory row fills "category" with its parent's name.

## Code

- `src/app/api/export/[kind]/route.ts`
- `src/lib/export/` — `csv.ts` (escaping, formula guard), `amount.ts`, `transactions.ts`, `files.ts`, `format.ts`
- `src/db/queries/export.ts`
- `src/app/(app)/settings/export/`

## Tests

`src/lib/export/*.test.ts` (escaping, amounts, dates), `src/db/queries/export.test.ts`; `e2e/export.spec.ts`.

## Related

[Transactions list](transactions.md) · [Split transactions](splits.md) · [Tags and notes](tags-and-notes.md) · `SPEC.md` §33, §46
