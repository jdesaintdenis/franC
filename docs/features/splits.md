# Split transactions

Split one transaction into parts with their own category and amount, e.g. a supermarket receipt between Groceries and Household.

## Using it

**Split** in the [detail sheet](transactions.md) on Transactions (or **Split** on the Review card) opens the *Split between categories* step: add, edit and remove parts. Each part has a category and a positive euro amount; the editor shows the remainder and applies the transaction's sign. Unlike the sheet's other fields, it keeps one **Save split** button, because the parts must add up first. Remove the split to go back to a single category. Saving or removing shows a toast with **Undo**, which puts the previous split (or none) back; there is no Undo when one of the previous parts' categories has since been deleted.

A split row's detail sheet shows its parts in place of the category; tapping them opens the split step.

A split row shows "Split · Groceries, Household" in the list.

## How it works

- Parts live in `transaction_splits (transaction_id, category_id, amount_cents, position)`. A transaction **is split exactly when it has parts**; there is no flag.
- **Validation** (pure): 2 to 20 parts, each with a category and a non-zero amount of the **same sign** as the transaction, summing **exactly** to it.
- **The original row is untouched**, including its own category, which is ignored while split and comes back if the split is removed. Re-importing the file still sees the row as a duplicate and keeps the parts.
- **Aggregations** read "category lines" (`categoryLines`): an unsplit row is one line, a split row one line per part. The category chart, drill-down and budgets use lines; month totals, the trend and counts use whole transactions (exact, since parts share the sign and the sum).
- **Filters**: a category filter matches a split when any part matches, and the row shows the matching parts' amounts. `category=none` matches a split only when a part has lost its category. Amount and direction filters use the whole transaction.
- **Never touched by automation**: rules, bank mappings, guesses and bulk edit skip split rows (bulk edit reports how many). A split row never shows as uncategorized.
- **Transfers**: a transfer leg can't be split, and a split row can't be linked or detected as a transfer. Both sides lock the rows.
- **Category delete**: parts follow the chosen option (moved to the parent, or left without a category, which puts them under Uncategorized).
- **Undo / account delete**: parts cascade with the transaction.
- **Review**: saving a split marks the row reviewed; removing a split doesn't.
- **Export** writes one line per part (see [Export](export.md)).

## Code

- `src/lib/splits/validate.ts`, `editor.ts` — validation and editor math (pure)
- `src/db/queries/splits.ts`, `split-sql.ts` (`categoryLines`)
- `src/app/(app)/transactions/split-editor.tsx`, `split-undo.ts` (Undo)
- Migration `0010_transaction_splits`

## Tests

`src/lib/splits/*.test.ts`, `src/db/queries/splits.test.ts` (sum validation, aggregation, undo).

## Related

[Transactions list](transactions.md) · [Budgets](budgets.md) · [Dashboard](dashboard.md) · `SPEC.md` §31, §54
