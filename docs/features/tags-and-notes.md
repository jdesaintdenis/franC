# Tags and notes

Write a note on any transaction, and tag transactions across categories (for example "Holidays 2026") to see what something cost in total, across groceries, restaurants and transport.

## Using it

- **Tap a row** on Transactions (or **Note and tags** in the [review queue](review-queue.md)) to open the [detail sheet](transactions.md), which has a **Note** field and a **Tags** section. Both save on their own, with a "Saved · Undo" toast:
  - **Note**: up to 500 characters. It saves 1 s after you stop typing and when you leave the field or close the sheet ("Saving…", then "Saved"); the toast ("Note saved", or "Note removed" when emptied) appears once per edit. A counter appears from 400 characters. Undo puts the previous note back.
  - **Tags**: your tags as chips, each with a remove button. Type a name (suggestions come from your existing tags) and press Enter, type a comma, or pick a suggestion. A new name creates the tag; an existing one is reused whatever its case. `Holidays 2026, Work` adds both. Undo removes the added tag or re-adds the removed one.
- **Rows** show the first line of the note (note icon) and up to 2 tag chips, then "+N".
- **Search** also matches notes and tag names.
- **Filter by tag**: the **Tag** select in the filters sheet (shown once you have tags). The active tag shows as a removable chip under the search bar.
- **Total**: whenever a filter is active, the count line also shows the net total ("12 transactions · −1 234,56 €"), plus "Spent X · Received Y" when the set has both.
- **Bulk**: in Select mode (Transactions ⋯ menu), switch the bar to **Tag** to add a tag to the selected rows (created when new) or remove one of the tags they carry.
- **More > Tags** (`/settings/tags`): every tag with its number of transactions. Tags are still created from a transaction, so there is no Add button; the empty page offers **Go to transactions**. Tapping a row opens a **rename** sheet; the ⋯ menu has Rename, See transactions (the filtered list) and **Delete**. Delete is immediate (it removes the tag from its transactions, never deletes a transaction) with **Undo**, which recreates the tag with the same id and re-links the transactions that still exist (`restoreTag`; refused if a tag of that name exists again).

A trip is: select the trip's rows → add the tag → filter by it → read the total.

## How it works

- **Tag names**: NFC-normalized, trimmed, inner spaces collapsed, 1 to 40 characters, no comma (commas separate tags in the input and the export). Unique per user, case-insensitively: renaming to a name another tag has is refused. A list with one invalid entry is refused as a whole.
- **Limits**: 10 tags per transaction, 200 tags per user. Bulk add skips rows already at 10 and says how many.
- **Notes**: trimmed, line breaks kept (`\r\n` becomes `\n`), at most 500 characters; empty removes. Never logged: the actions return codes only and swallow unexpected errors without logging them.
- **Tags are on the whole transaction**, not on split parts.
- **Tag filter** `?tag=<id>`, one tag at a time, parsed with Zod (invalid ids dropped). It carries into **Export CSV**.
- **Total** (`sumTransactions`): same `buildWhere` as the list; counts everything the filters show, internal transfers included unless hidden. Under a category filter a split row counts only its matching parts. Summed as bigint in SQL.
- **Undo import** removes the tag links of its transactions; the tags stay (0 transactions in More > Tags).
- Notes and tags are never part of the dedupe hash, so re-importing keeps them.
- Every query is scoped by `user_id`; `transaction_tags` has composite FKs to `transactions(id, user_id)` and `tags(id, user_id)`, so a link can never cross users.

## Code

- `src/lib/tags/validate.ts` (names, notes, limits), `src/lib/tags/list.ts` (sorting, merging)
- `src/db/queries/tags.ts` (list, create-or-reuse, rename, delete, add/remove, bulk, note); `sumTransactions` and the search/tag filter in `src/db/queries/transactions.ts`
- `src/app/(app)/transactions/`: `tags-actions.ts`, `note-form.tsx` (autosave via `src/lib/autosave.ts`), `tags-editor.tsx`, `transaction-sheet.tsx`, `bulk-bar.tsx`, `transaction-row.tsx`, `filter-chips.tsx` (tag chip), `page.tsx` (total)
- `src/app/(app)/settings/tags/` (`tag-list.tsx`)
- Migration `0021_tags_notes` (`transactions.note`, `tags`, `transaction_tags`)

## Tests

`src/lib/tags/validate.test.ts`, `src/lib/tags/list.test.ts`, `src/db/queries/tags.test.ts` (including delete with Undo), `src/db/queries/transactions.test.ts` (tag filter, search, totals, cross-user link rejected), `src/lib/transactions/filters.test.ts`; `src/lib/autosave.test.ts`; `e2e/tags.spec.ts`, `e2e/transaction-sheet.spec.ts`.

## Related

[Transactions list](transactions.md) · [Export](export.md) · [Split transactions](splits.md) · `SPEC.md` §46, §54
