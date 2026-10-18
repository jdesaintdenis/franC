# Review queue

After each import, go through the new transactions in a couple of minutes and know nothing slipped by.

## Using it

**Review** (`/review`), reached from the counters:

- a badge on the Transactions entry of the bottom bar and the desktop sidebar (capped at "99+"),
- a full-width "N to review" row above the Transactions list (it filters the list to those rows, where each can be validated with ✓; see [Transactions](transactions.md)),
- a row in Home's "Needs attention" list ("12 transactions to review"),
- "Review the N new transactions" (or "Review one by one" after a big import) on the import success screen,
- the "Check your categories" step of Home's welcome checklist.

The page shows "N to review", **Mark all as reviewed** (confirmation above 20 rows), **Guess categories**, and a **focus card** for one transaction: name, signed amount, date, account, bank label if different, a badge for the category source ("From your rule", "Bank category", "Guess"), a full-width category row that opens the same searchable category list as the [detail sheet](transactions.md), **Split**, **Transfer**, **Rename** and **Note and tags** (each opens the detail sheet at that step), a large **Reviewed** (or **Accept** on a guess) button, Previous / Next and "3 of 12".

- **A row needs a category to be validated** (Slice 58, SPEC §73): a category, a split, a confirmed transfer or being ignored. On a row without one the big button reads **Choose a category** (opens the picker) and swipe right opens the picker; **R**, **Mark all** and the bulk **Mark reviewed** skip such rows and the toast says how many stay ("2 transactions without a category stay in the queue"). Picking a category validates the row.
- **Phone**: only the focus card, tap targets ≥ 44 px. **Swipe right** marks reviewed (or accepts a guess) and moves on; **swipe left** skips without marking.
- **Desktop (md+)**: the card plus the whole queue grouped by import (file, or "Synced from <bank>" for a bank sync run, account, time, "Mark these N reviewed"), checkboxes and a bulk bar ("Mark N reviewed", category bulk edit).
- **Keyboard shortcuts**: J/↓ next, K/↑ previous, Enter/R reviewed and next, A accept guess, C category picker, S split, T transfer, N rename, X toggle selection, U undo, ? help. Ignored in fields, with a sheet or dialog open, or with a modifier key.
- Every mark leaves the queue at once and shows "Marked N as reviewed · **Undo**" in the shared toast (U runs that Undo); Accept guess too. If the save fails the rows come back with an error toast and **Try again**. Undo waits for the save to reach the server first. A category change on the card shows the shared "Moved to … · **Undo**" toast; its Undo restores the previous category and puts the card back in the queue where it was.
- The category list on the card (and the swipe-style picker) offers **Create "{search}"** when no category matches exactly; the bulk row's category select ends with **New category…** (Slice 54, see [Categories](categories.md)).
- Empty state: "All caught up" (green check) with **View transactions** and a quieter Import link; the page title stays "N to review".
- A rule suggestion may appear under the card after hand categorizations.

### Possible duplicates

When a CSV import or a bank sync brings a row that could be one of several existing rows of the other kind (same amount, within 3 days, none on its own date; see [Bank sync](bank-sync.md#how-it-works)), the row is inserted into the queue with a **Possible duplicate** badge (on the card, and on its row in the desktop list). Under the card, **Already in franC:** lists each candidate (name, signed amount, date, "From your bank" or "From CSV") with a **Same transaction** button, and below them **Keep both**.

- **Same transaction** (on the candidate that matches): the queued row is the candidate seen again, so it is deleted and its identity is remembered on the candidate, which keeps its category, note, tags and splits. Toast "Merged with the existing transaction"; **no Undo**.
- **Keep both**: they are two purchases. The candidate links are forgotten, the badge goes, and the row stays in the queue to be reviewed as usual. It is never asked again, because only incoming rows are matched. Toast "Kept both".
- Until you decide, the row counts in totals like any other.
- Buttons are ≥ 44 px high; `data-testid`s: `possible-duplicates` (the section), `possible-duplicate-candidate`, `possible-duplicate-badge`.

## How it works

- `transactions.reviewed_at` is null while a row is "to review". The column defaults to `now()`, so only `commitImport` (which inserts null, for CSV imports and bank sync runs alike) puts rows in the queue; older rows and other insert paths start reviewed. Duplicates on re-import keep their state.
- **Marks a row reviewed**: the Reviewed action (one, selection, one import, all; only rows that say where their money went, `markReviewed` guards it in SQL); validating from the list; adding a transaction by hand with a category; changing its category by hand anywhere, even to the same value; accepting a guess; saving a split; linking or confirming a transfer (both legs).
- **Does not**: renaming a merchant, rules applied to older rows, bank backfill, unlinking a transfer, removing a split. Bulk edit skips split rows, so they stay in the queue.
- **Undo** of a mark sets `reviewed_at` back to null by id; it does not revert a category you picked. The toast Undo of a category change does both (`restoreCategoryAction`).
- **Guess categories** puts newly guessed rows back in the queue.
- Undoing an import removes its rows from the queue by cascade.

### After a big import

After a first import, or one with 50 or more new rows, the import result offers **Guess categories, then mark all as reviewed** (`guessAndReviewImportAction`): it runs Guess categories (rules, bank mappings, then guesses, over all uncategorized rows), then marks reviewed **only that import's rows that now have a category** (`markReviewed` with `{ importId, categorizedOnly: true }`). Rows still uncategorized stay in the queue: "53 couldn't be guessed: Review them". The toast "465 transactions marked as reviewed · **Undo**" puts the marked rows back in the queue (in chunks of 500); the guesses themselves stay, as after Guess categories.
- The queue loads at most 500 rows (the header shows the real total); "Load the next ones" reloads.
- Rows are patched locally, with no reload between rows.
- A partial index on `(user_id, import_id) WHERE reviewed_at IS NULL` keeps the counter cheap.

## Not found in your bank (Slice 56)

A hand row still waiting for the bank more than 7 days after its date (`NOT_FOUND_AFTER_DAYS` in `src/lib/manual/not-found.ts`) gets its own section at the top of Review, with a count. Each row offers **Keep** (it stops waiting and stays), **Delete** (with Undo) and **Same as…**, which lists bank rows on the same account within 7 days with the same sign (not ignored, not transfers or splits, at most 20). Picking one deletes the hand row; the bank row takes its category (as manual), note and tags and is marked reviewed. A hand row that is a transfer leg can't be linked (deleting it would delete its Savings row). A split on the hand row is dropped, and the sheet says so first.

Code: `src/app/(app)/review/not-found-list.tsx`, `listNotFound` and `linkManualToBankRow` in `src/db/queries/manual-transactions.ts`. Tests: `e2e/manual-transactions.spec.ts`.

## Code

- `src/app/(app)/review/` — page, focus card, list, queue, swipe hook, shortcut help, actions
- `src/app/(app)/needs-attention.tsx` — Home row (built by `src/lib/dashboard/attention.ts`)
- `src/lib/review/` — `queue.ts`, `group.ts`, `shortcuts.ts`, `swipe.ts` (pure)
- `src/db/queries/review.ts` (queue items carry `possibleDuplicates`), `src/db/queries/duplicates.ts` (`mergeDuplicate`, `keepBoth`); the actions `mergeDuplicateAction` and `keepBothAction` in `src/app/(app)/review/actions.ts`
- Migrations `0015_review_queue`, `0028_manual_and_sync` (`duplicate_candidates`)

## Tests

`src/lib/review/*.test.ts`, `src/db/queries/review.test.ts`, `src/db/queries/duplicates.test.ts` (merge, keep both, user scoping); Playwright: import, review, counter goes to zero; `e2e/bank-sync-overlap.spec.ts` (Same transaction and Keep both).

## Related

[CSV import](csv-import.md) · [Categorization](categorization.md) · [Bank sync](bank-sync.md) · `SPEC.md` §40, §41, §54, §63
