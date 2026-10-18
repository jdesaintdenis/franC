# Transactions list

A fast, searchable list of every transaction, usable on a phone, with inline categorization and bulk edit.

## Using it

**Transactions** (`/transactions`):

- Newest first, **grouped by day**: each day has a header ("Today", "Yesterday", "Mon 28 Sept", with the year only for past years; see [Language and theme](language-and-theme.md)) that stays pinned under the search bar while you scroll that day, with the **day's net total** on the right (green when money came in, plain otherwise). Loading more as you scroll.
- **Search** updates the list as you type (after a short pause); there is no Apply button.
- **Filters button** right of the search field (shows how many filters are active). Under the search bar, one **removable chip per active filter** (to review, this month, expenses, income, uncategorized, category, account, tag, merchant, dates, amount, transfers, "Ignored shown" / "Ignored only"); the chips wrap onto several lines, the page never scrolls sideways (Slice 58). Tapping a chip removes its filter. The quick toggles are gone: the same choices live in the filters sheet.
- **Filters sheet** (bottom sheet on a phone, dialog on a computer): period presets (this month, last month, last 3 months, this year), From and To typed as **DD/MM/YYYY** (JJ/MM/AAAA in French; both app languages are day-first, unlike the browser's own date picker), category (including "Uncategorized"), account (with several accounts), tag (once you have tags), amount range, type (All / Expenses / Income), internal transfers (show / hide / only), ignored transactions (Hide / Show / Only, default Hide). *Apply* and *Clear all* (keeps the search).
- With any filter active, the count line also shows the **net total** of the filtered set, and "Spent X · Received Y" when it has both (see [Tags and notes](tags-and-notes.md)).
- A full-width "**N to review**" row (`review-attention`) above the list when rows are waiting in the [review queue](review-queue.md). Tapping it filters the list to those rows (`review=todo`, shown as a chip); it is hidden while that filter is on. The header menu has a "Review one by one" link to the `/review` screen while rows wait.
- The header's **⋯ menu** holds *Select* and *Export CSV* (every row matching the current filters, see [Export](export.md)), shown when there are rows.
- **Each row**: on the left the category's emoji (subcategories included, §66), or else the first letter of the name in the category's colour (grey when uncategorized), a split icon for split rows, ⇄ for transfers. Then the **name in normal case**: the merchant name, else the bank label, title-cased when the bank wrote it all in capitals ("CARREFOUR CITY" → "Carrefour City"; words with digits or dots, like "CB*1234" or "WWW.SNCF.COM", stay as written). Under it, small: the category's own name (✨ and italics for a guess), or the split summary ("Split · Groceries, Household"), or a transfer marker with the other account's name, plus the account with several accounts; then the note's first line and up to 2 tag chips. The amount is on the right (with the matching split parts under a category filter). The date is in the day header, not on the row; the bank icon and raw label are only in the detail sheet.
- **Validating from the list** (Slice 58, SPEC §73): every row that is not ignored carries a small mark on its icon, like a bank app: an **empty amber ring** (`row-to-review`, "To review" for screen readers) while it waits in the queue, a **filled green ✓** (`row-validated`) once validated. A waiting row and, when it has a category, a split, a confirmed transfer or is ignored, a **✓ button** (`row-validate`) that validates it at once: the ring turns into a ✓, the toast says "Validated · **Undo**". A row **without a category has no ✓**: it shows "Uncategorized" in amber. **Swipe right** does the same as ✓; on a row that cannot be validated it opens the category picker instead. Assigning a category by hand (picker, sheet, bulk, new row) validates the row; clearing it puts the row back to review.
- **Swipe right**, when the row has no category, opens the picker to **change its category**: a category picker sheet with a search field; tapping a category closes the picker and shows it on the row at once (manual, marks it reviewed) while it saves; the toast says "Moved to …" with Undo. If the save fails the row goes back and the toast says "Couldn't move it to …" with **Try again** ([feedback](feedback-and-motion.md)). A split row opens the detail sheet instead.
- **Swipe left** for **more actions**: Change category, Split, Note and tags, Rename merchant, Transfer (when it is one), Select. All but Select open the detail sheet at that step (Note and tags focuses the note).
- A one-time tip on phones explains the swipe until you dismiss it or swipe.
- **Keyboard and mouse**: each row has a **⋯ button** (visible from tablet width, shown on focus on phones) that opens the same actions sheet.
- **Tap a row** to open the **detail sheet** (a bottom sheet on a phone, a dialog on a computer). The header shows the name, the amount in large sans serif (green for money in; francs and the serif face stay on Home's hero, SPEC §73), the friendly date, the account (with several accounts) and the raw bank label when it differs from the name. **Ignore** and **Delete** sit in their own amber-outlined card, apart from the other actions. Below it, every field **saves on its own**; there is no Save, Update or Add button, and the sheet stays open so you can make the next change:
  - **Category**: tap the row to open the *Choose a category* step (a searchable list); tapping a category saves it, validates the row and comes back. Under the row, up to 4 **suggestion pills** (`sheet-suggestion`: past choices for the same merchant, then the same label, then the most used in the last 90 days, `suggestCategories`) pick a category in one tap, with the first top-level categories filling the row when there is little history, and **+ New** (`sheet-new-category`) opens the same create form as the category step (same component as Settings > Categories, see [Categories](categories.md)). The source shows under it ("Set by a rule", "Guessed from your past choices"…). When the row waits in the queue and has a category, a **Validate in {category}** button (`sheet-validate`) validates it (an accepted guess becomes a hand choice) and closes the sheet; without a category the button is not there. A split row shows its parts instead.
  - **Rule suggestion**: right after you change the category, a card asks "Always put Carrefour in Groceries?" with **Create rule**, **Adjust** (a *New rule* step with match type and pattern) and ✕. When you already put that merchant in that category several times, the usual "You put N … Always do this?" line shows instead. See [Categorization](categorization.md).
  - **Note**: saves 1 s after you stop typing and when you leave the field or close the sheet ("Saving…", then "Saved").
  - **Tags**: Enter, a comma or a suggestion adds a tag; ✕ removes it ([Tags and notes](tags-and-notes.md)).
  - **Rename merchant**, **Split** and **Internal transfer** (with several accounts) open as steps inside the sheet, with a ‹ back button ([Merchant names](merchant-names.md), [Split transactions](splits.md), [Internal transfers](internal-transfers.md)). Split and rename keep one confirm button, because a split has to add up and a rename changes every matching transaction.
  - **Origin**: a small line (`data-testid="sheet-origin"`) says **From your bank** for a synced row, or **From CSV, 12 Sept** for an imported one (the day of the import, Europe/Paris, `formatShortInstant`).
  - **Track as regular payment** (or **Regular payment** once tracked, opening the item): see [Recurring payments](recurring.md).
  - **Ignore** / **Stop ignoring** (see below).
- **"Saved · Undo" toast**: every change shows a short message at the bottom ("Moved to Groceries", "Note saved", "Tag “Holidays” added", "Split saved", "Rule created · 12 other transactions categorized"…) with **Undo** for 6 seconds (longer while hovered or focused). Category changes in the sheet apply at once and save in the background, in tap order; a failed save reverts with an error toast and Try again. Bulk Categorize and bulk tag changes apply at once too (a brand-new tag waits for the server); their counts come in the toast, not in a line on the page. An empty list says "No transactions yet" with **Import your bank export**, or "Nothing matches" with **Clear filters**. Undo puts back the previous category with its source and review state, the previous note, the tag, the previous split, the transfer link, removes the merchant name that was added, or deletes the rule and un-categorizes only the rows it had just categorized. Confirming a detected transfer has no Undo (unlink it instead). While the sheet is open the toast shows inside it, so Undo is reachable with the keyboard.
- **Select** mode (from the ⋯ menu or a row's actions): pick loaded rows (or "Select all loaded", up to 500), then set or clear their category, or add or remove a tag, at once.
- Rows also show the note's first line and up to 2 tag chips.
- After a swipe or bulk categorization, a **rule suggestion** line may appear under the toolbar ("You put N X in Category. Always do this?"); changes made in the detail sheet show their suggestion in the sheet instead.

## How it works

### Pagination

- The server renders the first 50 rows; the client list is virtualized (`@tanstack/react-virtual`, window virtualizer) and fetches further pages through the `loadMoreTransactions` server action.
- **Keyset pagination** on `date desc, id desc` with a `YYYY-MM-DD_uuid` cursor, so imports or undos between fetches never cause gaps or repeats.

### Day groups

- The page is in the 50 F look (SPEC §73): `theme-50f` on the page, the sheets and the bulk bar (they are portals, so each carries the class), error toasts amber. Each day is one note-blue card whose header carries the small Cinzel date and the day total (sheets keep the card colour: the night ground lives on `.theme-50f.bg-50f` only); `toListEntries` also flags each row `first`/`last` for the card corners.
- `toListEntries` (`src/lib/transactions/day-groups.ts`) inserts a day header before the first row of each date; the window virtualizer renders headers and rows, and always keeps the current day's header rendered (`rangeExtractor`) so it can be `position: sticky`.
- **Day totals come from the server** (`sumTransactionsByDay`, same filters and split-part rule as `sumTransactions`), for the dates of each page, so a day cut across two pages still shows its full total.

### Swipes

`rowSwipeOutcome` (`src/lib/transactions/row-swipe.ts`): touch and pen only, a vertical move scrolls instead; past 35 % of the row width (at least 72 px) right = validate (or category when the row cannot be validated), left = more; the drag is clamped to 60 %. Disabled in selection mode.

### Filters live in the URL

`q`, `from`, `to`, `category`, `account`, `merchant`, `tag`, `min`, `max`, `direction`, `transfers`, `ignored`. They are parsed with Zod by `parseTransactionFilters`; invalid params are **dropped**, not rejected, so a bad URL still renders. `min`/`max` are swapped when reversed. `from`/`to` are ISO in the URL, but DD/MM/YYYY is accepted too (`parseDayInput`), so the search still works as a plain GET form without JS. Quick chips are plain links built with `withParams`.

- **Search** matches the raw label, the bank's short label, the merchant name, the note and tag names, case- and accent-insensitive in both directions ("Vétérinaire" ⇄ "Veterinaire", via Postgres `unaccent`). LIKE wildcards match literally.
- **Category**: a parent includes its subcategories. `category=none` = uncategorized. A split row matches when any part matches, and then also shows the matching parts' amounts.
- **Amount** compares the **absolute** amount (euro text in the URL, e.g. `min=12,50`), combined with the direction toggle.
- **Merchant** (`merchant=<id>`) is set by the Recurring page's "see transactions" link and shows as a removable chip.
- **Tag** (`tag=<id>`): rows carrying that tag; shows as a removable chip.
- **Transfers**: `hide` or `only`.
- **Ignored**: hidden unless `ignored=show` or `only`.
- Another user's account or category id simply returns nothing: every query is scoped by `user_id`.

### Ignoring a transaction

**Ignore** (sheet, `data-testid="sheet-ignore"`; "Écarter" in French, since "ignorer" is already used for regular payments) hides a transaction from everything that adds money up, while franC keeps it so it never comes back. The detail line says "Hidden from totals. It won't come back on the next sync or import."

- Sets `transactions.ignored_at` and marks the row reviewed. The toast "Ignored" has **Undo**; **Stop ignoring** (`sheet-unignore`) reverses it ("No longer ignored").
- **Excluded** (through `countable()` in `src/db/queries/transfer-sql.ts`, which is "not in a transfer and not ignored"): Home totals and the category breakdown, the year view, budgets, [recurring](recurring.md) detection, [transfer](internal-transfers.md) pairing, category guessing and the account [balance](accounts-and-balance.md).
- **Still seen** by duplicate prevention and the sync/CSV matcher: re-syncing or re-importing never brings an ignored row back, and an ignored duplicate stays ignored.
- The list **hides** ignored rows by default; the `ignored` filter (`#tx-ignored`: Hide / Show / Only, URL `ignored=show|only`) lists them, with an **Ignored** badge on the row (`row-ignored`). Export follows the filters.
- Transfer legs cannot be ignored ("Unlink the transfer first").

### Categorizing

- A hand choice sets `category_source = manual` and marks the row reviewed, even when re-picking the same category. Clearing removes both category and source, so rules can fill it again later.
- **Create from the picker** (Slice 54): the picker (detail sheet, swipe) offers **Create "{search}"** when nothing matches exactly; **Create and use** makes the category and applies it like a pick. The bulk bar's category select ends with **New category…**, which creates it and applies it to the selection. See [Categories](categories.md).
- **Bulk edit** (`bulkCategorize`): up to 500 of your own rows, one DB transaction, source `manual`. Split rows are skipped and the result says how many. Selection never extends to rows that aren't loaded.
- Loaded rows are patched in place; no full reload.
- **Undo a category change** (`restoreCategoryAction`): the client sends the previous category, source and whether the row was reviewed; the server checks the category is yours and restores all three (an unreviewed row goes back to the review queue).

## Transactions added by hand (Slice 56)

For spending the bank never shows (cash, the Swile meal card), the **＋** button on Transactions opens "Add a transaction": expense or income, amount, what, date (today or earlier, not before 2000), a Current account and an optional category. Without a category your rules and merchant names apply to the label, like an imported row. Savings accounts are not offered.

- A hand row is stored with `source = 'manual'` in the account's hidden franC import, reviewed from the start, with `dedupe_hash = 'manual:<id>'`.
- **Final or waiting.** On an account a bank link or any CSV/sync import feeds, the row is flagged `awaiting_bank` and waits for the bank (see [bank-sync.md](bank-sync.md) for the matching). On an account never fed, such as one made for Swile, it is final. There is no account setting: this is derived when the row is added.
- **Edit** and **Delete** (with Undo, which restores category, note and tags) are in the row's sheet. Ignore is not offered. A changed amount is refused while the row is split or a transfer leg.
- The sheet's origin line says "Added by you", "Added by you, waiting for your bank" or, once taken over, that it was matched with the bank.
- The list refreshes after these actions through `manualVersion`, a fingerprint of the user's hand rows added to the list's data version.

Code: `src/db/queries/manual-transactions.ts`, `src/lib/manual/`, `src/app/(app)/transactions/{manual-actions.ts,manual-form.tsx,add-transaction-sheet.tsx}`. Tests: `src/lib/manual/*.test.ts`, `src/db/queries/manual-transactions.test.ts`, `e2e/manual-transactions.spec.ts`.

## Code

- `src/app/(app)/transactions/` — page, list, row, search (`transaction-filters.tsx`), chips, filters sheet, page menu, category picker and row actions sheets, swipe hook, detail sheet (`transaction-sheet.tsx`, `sheet-steps.tsx`, `rule-proposal.tsx`, `category-picker-list.tsx`, `category-change.ts`, `split-undo.ts`), bulk bar, split editor, transfer section, rename form, note and tags fields, actions, `undo-actions.ts`
- `src/components/toast.tsx` — the "Saved · Undo" toast (provider in the `(app)` layout)
- `src/lib/autosave.ts` — the note's debounced save
- `src/components/transaction-avatar.tsx` — the row's emoji or initial
- `src/lib/transactions/filters.ts` — URL filter parsing, `parseDayInput`, period presets, `withParams`
- `src/lib/transactions/day-groups.ts`, `display-case.ts`, `row-swipe.ts`, `validation.ts` (`hasDestination`, `canValidate`) — day headers, title-casing bank labels, swipe thresholds, what can be validated
- `src/lib/categorize/suggest-categories.ts` — the sheet's suggestion pills; `review-attention-row.tsx`, `filter-chips.tsx` — the attention row and the wrapping chips
- `src/db/queries/transactions.ts` — list (with the row's origin from its import), `setIgnored`, `buildWhere`, `sumTransactions`, `sumTransactionsByDay`, categorize, bulk, `restoreTransactionCategory` (undo)

## Tests

`src/lib/transactions/{filters,day-groups,display-case,row-swipe}.test.ts`, `src/db/queries/transactions.test.ts`; `src/lib/transactions/validation.test.ts`, `src/lib/categorize/suggest-categories.test.ts`; Playwright `e2e/validate-in-list.spec.ts` (✓, Undo, no ✓ without a category, sheet validation, no sideways scroll), `e2e/transactions.spec.ts` (live search, day headers and totals, filters sheet with DD/MM/YYYY, chips, swipe to recategorize and its keyboard equivalent, ⋯ menu), `e2e/transaction-sheet.spec.ts` (category change without a Save button and its Undo, note autosave, tags with Enter, rule suggestion and its Undo); `src/lib/autosave.test.ts`; `src/db/queries/ignore.test.ts` (totals, balance, recurring and transfers skip ignored rows; a re-sync does not bring one back), `src/lib/format-date.test.ts` (origin day); `e2e/bank-sync-overlap.spec.ts` (origin line, Ignore, the Show filter).

## Related

[Categorization](categorization.md) · [Categories](categories.md) · [Export](export.md) · [Tags and notes](tags-and-notes.md) · [Bank sync](bank-sync.md) · `SPEC.md` §18, §19, §26, §46, §53, §54, §63, §73
