# Merchant names

Turn bank gibberish like "PRLV ORANGE BOX" into "Orange", once, for every matching transaction past and future.

## Using it

- **From a transaction**: in the [detail sheet](transactions.md), **Rename merchant** opens a step with the name (suggesting your existing names; picking an existing one adds a pattern to it), a match type and a pattern. It starts with **is exactly + the bank's short label**, which is safe by default, and a live line "Renames N transactions" lets you widen the pattern before tapping **Rename** (one confirm button, because it changes every matching transaction). The toast "Merchant saved · N transactions renamed" has **Undo**: it deletes the merchant if it was new, else removes the pattern it added.
- **More > Merchant names** (`/settings/merchants`): merchants by name, captioned "12 transactions · 2 patterns". **＋ Add** opens a sheet (name + first pattern). Tapping a row opens the merchant sheet: rename, its patterns with a remove button each (with Undo), and Add a pattern. The ⋯ menu has Edit, See transactions and **Delete**. Delete is immediate (its rows go back to the bank's label) with **Undo**, which recreates the merchant with the same id and patterns and re-runs matching, so the rows get the name back (`restoreMerchant`; refused if the name is taken again). With none, the page says "No merchant names yet" with **Add a merchant name**.

## How it works

- A merchant has a **name** (1–60 characters, unique per user ignoring case) and one or more **patterns** (`contains`, `starts_with`, `equals`; ≤ 200 characters; no regex). E.g. Intermarché = `INTERMARCHE` + `INTERMAR CENTRE`.
- A pattern matches when the row's normalized label or normalized display label matches, so case and accents never matter.
- **Precedence** when several patterns match: most specific type (`equals` > `starts_with` > `contains`), then longer pattern, then oldest.
- The result is stored on `transactions.merchant_id`. It is computed:
  - for new rows on import (before rules run; the preview already shows names),
  - for all your rows after any pattern/merchant change (`recomputeMerchants`, only writing rows whose result changed). A pure rename needs no recompute since rows point at the id.
  - After the commit, rules re-run on uncategorized and bank-categorized rows, and recurring detection refreshes (skipped for a pure rename).
- **Labels are never modified**: `label_raw`, `label_normalized` and `label_display` stay intact, so dedupe is unaffected.

### Where the name is used

Display name = merchant name, else `label_display`, else `label_raw`. Used in the transactions list, split editor, transfer section, detail sheet title, recurring items, Coming up, price alerts, the balance warning, and the export `label` column (the `bank label` export column stays raw). The detail sheet shows the raw bank label when it differs.

- **Search** matches the raw label, the short label and the merchant name.
- **Rules** see the merchant name as a third label, so a rule `contains amazon` catches every row named Amazon.
- **Recurring detection** groups by `merchant:<id>` when a row has a merchant, so renamed variants form one item. Existing items are re-keyed to follow their transactions, keeping their status and alerts.
- **Guessing** and **rule suggestions** use the merchant id first.

## Code

- `src/lib/merchants/match.ts` — matching and precedence (pure)
- `src/lib/merchants/input.ts`, `error-codes.ts`
- `src/db/queries/merchants.ts` — CRUD, `recomputeMerchants`, live count, `restoreMerchant`
- `src/app/(app)/settings/merchants/` (`merchants-screen.tsx`, `merchant-sheet.tsx`)
- `src/app/(app)/settings/merchants/`, `src/app/(app)/transactions/rename-merchant-form.tsx`, `merchant-filter-chip.tsx`
- `src/lib/recurring/rekey.ts` — re-keying recurring items
- Migration `0014_merchant_names`

## Tests

`src/lib/merchants/*.test.ts`, `src/lib/recurring/rekey.test.ts`, `src/db/queries/merchants.test.ts` (including restore); `e2e/merchants.spec.ts` (delete with Undo gives the name back).

## Related

[Categorization](categorization.md) · [Recurring payments](recurring.md) · [Transactions list](transactions.md) · `SPEC.md` §39, §54
