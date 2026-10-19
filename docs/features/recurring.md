# Recurring payments and forecast

franC finds your subscriptions, bills and salary on its own, shows what they cost you a month on one screen, forecasts next month, shows what they cost per year, alerts you when a subscription gets more expensive, and notices the ones you've probably cancelled.

## Using it

**Regular payments** (`/recurring`), opened from **Plan > Regular payments**. The header has the back arrow to Plan and a **Detect now** icon button (re-runs detection by hand; the result is a toast). With nothing found yet the page says "No regular payments yet" with **Look for them now**, or **Import your bank export** when there are no transactions.

- **Headline** (50 F card): "€1,432 a month confirmed" with "€17,184 a year · 14 payments" and, when there is confirmed income, " · income +€2,850 a month". Only **confirmed** outflows count (Slice 60); detected, ended and dismissed items never do. "No bills or subscriptions found yet" when there are none.
- **To confirm** (block under the headline, amber border, Slice 60): the detected items (bills first, then income, after the category filter), gone once none is left. **One at a time** (default): "1 of 42 · €320 a month in all", the first item's category tile, name, caption, amount ("a month · €120 a year"), its last 4 charges and two buttons, **Dismiss** and **Confirm**; swipe right confirms, left dismisses, tapping the card opens the item sheet. **See the list** switches to a list ("42 payments found", "They come back every month. Keep them in your forecasts?") with a ✕ and a ✓ on each row, the first 5 then **See the 37 others**, and **Confirm all** (one transaction; the toast's **Undo** puts exactly those back to detected). **One by one** switches back; the choice is kept on the device (`localStorage` key `franc:recurring-to-confirm-view`).
- **Sort** (link on the Bills title) opens one sheet, **Sort and filter**: Sort by (Next date, Cost per year) and Category (All, categories in use, Uncategorized). Choices apply at once and are kept in the URL (`?sort=`, `?category=`), as is `?account=` from the account links. With a category on, the link reads "Sort · Groceries".
- **Sections**: **Bills and subscriptions** (confirmed outflows) and **Income** (confirmed, with "+€2,850 a month" in its header), each **folded to 4 rows** with a **Show N more** button under the card (Slice 64; `foldedCount` in `src/lib/recurring/sections.ts`). Items that need a look (price alert, "Cancelled?") come first and are never folded away, so more than 4 rows can show. The button turns into **Show less** (it keeps keyboard focus); the unfolded state is not remembered, a reload folds again. Then then collapsed **Ended (N)** (with Resume and "You no longer pay X a year") and **Dismissed (N)** (with Restore).
- **Rows**: category tile (or initial), name, amount (income green, outflows in ink) and one caption: "Every month · next 5 Oct", or in the warning colour "Cancelled?" or the price rise as "€39.99 €44.99" (old struck through, new in amber), those rows first in their section. The account name is added with several accounts.
- **Swipe** (touch and pen only): right **confirms** a detected row, left **dismisses** a detected or confirmed one; the action's label shows behind the row while dragging. A one-time tip explains it.
- **Item sheet** (tap a row, or `/recurring?item=<id>` from Home's Coming up and price-alert rows): amount, cadence and next date, yearly cost (not on yearly items), account, pills; the **price increase** ("Was €39.99, now €44.99 (+€5.00, +13%)") with **Accept new price** and **Keep €39.99**; the **Cancelled?** callout with **Mark ended** and **Still active**; **Last charges** (the 12 newest, the one that raised the price marked "new price") and **See all transactions**; on a running outflow with a category, **Create a Groceries budget** (opens the budget form on `/settings/budgets?edit=<category>&amount=<cents>`, pre-filled with the payment when monthly) or **Open the Groceries budget** when the category or its parent already has one (`src/lib/recurring/budget-link.ts`); on a confirmed income, the **Keep for next month** switch (hatched marker, a one-line hint that changes with it; off by default): its charges received this month wait for next month in Reste à vivre, except on the 1st–7th ([Safe to spend](safe-to-spend.md)), with a toast and Undo; then the actions: **Confirm**, **Mark ended**, **Dismiss**, **Resume** or **Restore**.
- **Track as regular payment** (transaction sheet, on any payment that isn't ignored, a transfer leg or a franC-created row) makes a confirmed item that follows every payment with the same label or merchant, whatever the amount, for salaries that vary by more than ±10%. Its amount reads "about +€2,850" (whole euros) on Regular payments, the item sheet, Next month and Coming up; the sheet adds "Last 6 payments: +€2,400 to +€3,300" and **Stop tracking**. Once tracked, the transaction sheet row reads **Regular payment** and opens the item. The toast offers Undo.
- **Every action is immediate and undoable** from the toast ("Rent dismissed · Undo"); there are no confirmation dialogs. Undo of a confirm sets the item back to detected, of a dismiss restores its previous status, of Mark ended resumes it. Accept and Keep price have no Undo. Failures put the item back with an error toast. Server calls run in click order, so an Undo tapped right away reaches the server after its change.

**Next month** (`/budget/next-month`, from **Budget > Next month** and the safe-to-spend card from the 28th), in the 50 F look (Slice 63, `SPEC.md` §78). The title is the month ("November 2026") with "Next month" above it. Sections:
- **What's left**: one figure, `nextMonthOutlook` = expected income − the base budgets (no carry-over, a negative budget counts as 0) − regular payments **not covered by a budget**. A payment in a budgeted category (or a subcategory of one) is already inside that budget, so it is never counted twice (`plannedSpendingCents`). Green when positive, amber (never red) when negative, with a sentence ("about €X left to save or spend outside your budgets" or "€X short") and three columns In, Payments, Budgets. Without budgets the Budgets column and the note say so and link to Budgets. "Based on data up to …" ([Import reminder](import-reminder.md)) ends the note. The same figure is the hint of the Next month row on the Budget page.
- **To confirm**: when detected items are projected, one amber row "N regular payments to confirm" links to Regular payments. In the lists a detected item carries an amber dot and the screen-reader text "to confirm", not a badge.
- **Budgets** card (when there are budgets): each budget per month, link to Budgets.
- **Expected payments** and **Expected income**: flat lists of every occurrence (date, category tile, name, amount), each row a link to the item on Regular payments. Two columns from `lg`.
- Nothing expected shows an empty state linking to Regular payments. There is no account filter.

**Home**: **Coming up** lists the next 3 occurrences within 30 days, each opening its item sheet, with "See all regular payments"; open price alerts are "Needs attention" rows opening the item's sheet; from the 28th the safe-to-spend card shows next month's expected net.

Detected items are always distinguished from confirmed ones by place and text (the "To confirm" block on Regular payments, the amber dot and "to confirm" in the forecast), never colour alone. Warnings use the warning colour; red is never used on amounts.

## How it works

### Detection

Pure, in `src/lib/recurring/detect.ts`; runs **per account**.

- **Grouping key**: `merchant:<id>` when a row has a [merchant name](merchant-names.md), else `merchantKey(label_normalized)`, which strips bank noise (`CB`, `PRLV`, `VIR SEPA`… prefixes, `FACT ddmmyy` card suffixes, loan date suffixes, trailing numbers; all ATM withdrawals fold into `RETRAIT DAB`). Groups are also split by **sign**, so salary is detected too; when both signs qualify, the larger group wins.
- **Intervals** (days between charges, inclusive): weekly 6–8, monthly 27–33, quarterly 85–97, yearly 355–375.
- **Qualifying**: the band comes from the latest gap; walking back from the latest charge while gaps stay in the band and amounts stay within **±10%** of the latest amount. That trailing run needs **≥ 3** charges. Two charges on the same day disqualify the group. `typical_amount_cents` = lower median of the run.
- **Staleness**: dropped if the last charge is more than 2 intervals before your latest transaction date (data-driven, not "today", so detection stays pure).
- Internal transfers (except the Current-account leg of a transfer to or from a Savings account, so "VIR LIVRET A" is detected) and [ignored](transactions.md#ignoring-a-transaction) transactions are skipped.
- `next_expected_date` = last charge + interval (months keep the day, clamped to month end).

### Refresh (`refreshRecurring`, one DB transaction)

- New candidates are inserted as `detected`.
- Existing detected/confirmed items are updated, keeping their status.
- Detected items that no longer qualify are deleted.
- Confirmed items are kept (dates refreshed) unless the merchant has no transactions left.
- **Dismissed** items are never updated or re-suggested by detection. Only the user brings one back (Undo or **Restore**, see below).
- **Ended** items keep their links but not their dates, and are never re-suggested. A charge **newer than their last one** brings them back as **confirmed** (checked first, so price alerts then apply as usual). They are deleted when the merchant has no transactions left.
- Items are first re-keyed to follow their transactions (after a merchant rename or merge), keeping status and alerts.
- `transactions.recurring_id` links are rebuilt.

Runs after each import, undo and account delete (after transfer detection, in its own step that never fails the import), after transfer changes, after merchant changes, and on **Detect now**.

### Tracked payments (`source = manual`)

Pure part in `src/lib/recurring/tracked.ts`; queries `trackRecurring` and `untrackRecurring`.

- **Track** (`trackRecurring`): finds the row's group (same key and sign on its account, ignored rows and transfer legs skipped) and upserts a **confirmed** `manual` item. An item already on that key (detected, dismissed or ended) becomes the tracked one; the toast's Undo restores its earlier status through `untrackRecurring`.
- **Expected amount** = lower median of the newest **6** payments (`trackedFields`, `TRACKED_WINDOW`), stored in `typical_amount_cents`, so the forecast, Coming up, Next month, [balance projection](accounts-and-balance.md) and [safe to spend](safe-to-spend.md) use it unchanged. **Cadence** = the band of the median gap between those payments, else the stored interval (monthly at creation). Dates follow the newest payment.
- **Refresh**: candidates never touch a tracked item and it never gets price alerts (its amount varies by design). Each refresh recomputes amount, cadence and dates from all its payments and relinks them. It is deleted only when none of its payments is left (undone import). Dismiss, Mark ended, Resume and Restore work as on any item and keep it tracked.
- **Stop tracking** (`untrackRecurring`) sets `source` back to `detected` with status `detected`, then refreshes: it stays as "To confirm" if detection finds it, else it disappears. Its Undo tracks again from the newest payment.

### Dismiss and restore

- Dismissing unlinks the item's transactions and takes it out of every projection; it is listed under **Dismissed** on Regular payments only (`listRecurring` with `includeDismissed`).
- `restoreRecurring` brings a dismissed item back as **detected** or **confirmed** (Undo restores the previous status; **Restore** makes it confirmed), then `refreshRecurring` runs so its transactions are linked again and its dates are fresh. A restored detected item that no longer qualifies disappears, as any detected item would.
- `setRecurringStatuses` applies several changes in one transaction, all or nothing (Confirm all and its Undo). Going from confirmed back to detected is allowed for Undo.

### Forecast

- Every item that is neither dismissed nor ended is projected from its last charge as `last + k·interval` with no clamping drift (a 31st goes to Feb 28/29 and back to Mar 31). Weekly items appear 4–5 times a month.
- **Next month** = the calendar month after the current one (Europe/Paris), independent of the dashboard month. Shown on `/budget/next-month`.
- Totals: expected out, expected in, net = in − out. The headline includes detected items; the confirmed-only net is shown separately when detected items are included.
- **Coming up**: today through today + 30 days, soonest first, max 5 (Home shows the first 3); past-due occurrences are not listed. Hidden when you have no recurring items.
- The same occurrences drive the [balance projection](accounts-and-balance.md) and [safe to spend](safe-to-spend.md).

### Yearly cost

Pure, in `src/lib/recurring/yearly.ts` and `list-view.ts`.

- Monthly (headline) = the yearly cost of running outflows ÷ 12, rounded down (`regularTotals`), computed separately for the detected share; income has its own monthly figure.
- Yearly cost = usual amount × **52** (weekly), **12** (monthly), **4** (quarterly), **1** (yearly), in integer cents. Weekly counts 52 weeks, not 365/7.
- The headline counts **confirmed and detected** outflows, with the detected share shown. Income, ended and dismissed items never count.
- Sorting by yearly cost puts the largest outflow first and income last, within each list (ties by name).

### Cancelled? and ended items

Pure, in `src/lib/recurring/missed.ts`.

- Expected charge k is `last + k·interval` (same no-drift stepping as the forecast). It counts as **missed** once the reference date is past it by more than a grace period: weekly **2** days, monthly **3**, quarterly **7**, yearly **10**.
- The reference date is the **latest transaction on the item's account** (any transaction, transfers included), not today: a break in importing never flags anything, and another account's newer data doesn't either.
- A **confirmed** item with **≥ 2** missed charges is flagged **Cancelled?**. Detected items never are (they go stale and disappear on their own).
- **Still active** stores the account's latest date (`still_active_at`); the flag stays hidden until more charges are missed than at that date. A newer charge resets the count.
- **Mark ended** (status `ended`, `ended_at` = today in Europe/Paris) works on any confirmed item. It leaves the forecast, Coming up, the [balance projection](accounts-and-balance.md), [safe to spend](safe-to-spend.md) and the yearly total, and its open price alert is deleted. `listRecurring` leaves ended items out unless asked (`includeEnded`, used by the Recurring page only), and the forecast skips them too.
- **Resume** makes an ended item confirmed again and counts as "Still active", so the flag doesn't come straight back.

### Price alerts

- Raised when an item's newest charge is an **outflow more than 10% above** its usual amount (`(|charge| − |usual|) × 10 > |usual|`, so exactly +10% doesn't alert). Price drops and income changes never alert.
- **Renewal only**: the charge must come at least the interval's minimum gap after the previous one, so an extra mid-period purchase isn't read as a new price.
- Detected and confirmed items both get alerts. One open alert per item; a resolved charge is never raised again.
- A newer, still higher charge moves the alert; a charge back within tolerance clears it (a one-off spike leaves nothing).
- While an alert is open, the item is kept and its usual amount isn't overwritten; the forecast keeps the usual amount.
- **Accept new price**: sets the usual amount to the new one and confirms the item. **Dismiss**: keeps the usual amount, for that charge only.
- Alerts need an existing item, so price changes are caught when you import at least once per period.
- Shown on Regular payments (the row's "Price up · +€X" caption, the sheet's "Was …, now …" block), on Home as "Needs attention" rows (one per alert up to 2, else "3 prices went up"), and counted on the import result.

## Known limitation

Standing orders between two Current accounts are internal transfers and aren't detected as recurring. Those to a Savings account are (Slice 52); the Savings-side row is a transfer leg and isn't.

## Code

- `src/lib/recurring/` — `tracked.ts`, `merchant-key.ts`, `detect.ts`, `dates.ts`, `forecast.ts`, `price-alerts.ts`, `price-change.ts`, `rekey.ts`, `optimistic.ts` (status changes and alert resolution, single and bulk), `yearly.ts`, `missed.ts`, `list-view.ts` (URL params, category filter, sort, `regularTotals`), `sections.ts` (`splitSections`)
- `src/db/queries/recurring.ts` (`refreshRecurring`, `trackRecurring`, `untrackRecurring`, `listRecurring`, `setRecurringStatus`, `setRecurringStatuses`, `restoreRecurring`, `listRecurringHistory`, `markRecurringStillActive`), `price-alerts.ts`
- `src/app/(app)/recurring/` (`recurring-screen.tsx` holding the optimistic list, `use-recurring-changes.ts` with toasts, Undo and the call queue, `regular-headline.tsx`, `to-confirm-block.tsx` (card and list modes), `recurring-filters-sheet.tsx`, `recurring-sections.tsx`, `recurring-row.tsx` with the swipe, `recurring-sheet.tsx`, `recurring-pills.tsx`), `src/lib/recurring/to-confirm.ts` (`toConfirmQueue`), `regularTotals` in `list-view.ts`, the swipe hook `transactions/use-row-swipe.ts` (with `directions`), `src/app/(app)/plan/next-month/` (`forecast-summary.tsx`, `forecast-entry-row.tsx`), `src/app/(app)/coming-up.tsx`, `needs-attention.tsx`, `src/components/expected-amount.tsx` ("about" amounts), the Track row in `transactions/transaction-sheet.tsx`
- Migrations `0007_multiple_accounts`, `0011_recurring_price_alerts`, `0020_recurring_ended`, `0033_tracked_recurring` (`recurring.source`, default `detected`: existing items keep status, alerts and links)

## Tests

`src/lib/recurring/*.test.ts` (budget link: create, pre-fill, parent budget, income, monthly/weekly/yearly/non-recurring fixtures, forecast including ended items, price increase vs tolerance vs one-off spike, yearly cost per interval, missed cycles with grace and month ends, Still active, category filter with subcategories, sorts, yearly and monthly totals, sections, optimistic bulk changes), `src/db/queries/recurring.test.ts`, `recurring-restore.test.ts` (restore and relinking, confirmed → detected, bulk all-or-nothing, history, `includeDismissed`, user scoping), `recurring-ended.test.ts` (flag per account, Still active, end/resume, revival, deletion, price alert dropped, user scoping), `price-alerts.test.ts`, `tracked.test.ts` (median of the last 6, cadence, range), `recurring-tracked.test.ts` (track, refresh keeps it, outliers, dismissed and Undo, stop tracking, user scoping); `e2e/budget-charges.spec.ts` (create a budget from a payment, folded at 95 %), `e2e/recurring-tracked.spec.ts` (track a varying salary, "about", range, Next month, stop); `e2e/recurring.spec.ts` (headline, sheet history, Confirm all + Undo, dismiss + Undo, swipe left and right, Dismissed + Restore, Detect now), `e2e/price-alerts.spec.ts` (Home row opens the sheet, accept), `e2e/keep-for-next-month.spec.ts` (the switch), `e2e/subscriptions.spec.ts` (yearly cost, sort chip, mark ended, resume, next month).

## Related

[Merchant names](merchant-names.md) · [Bank accounts and balance](accounts-and-balance.md) · [Safe to spend](safe-to-spend.md) · `SPEC.md` §8, §9, §21, §22, §32, §45, §56, §66, §68

A confirmed regular payment can be linked to a loan, which splits each bank debit into capital, interest and insurance: see [Loans](loans.md).
