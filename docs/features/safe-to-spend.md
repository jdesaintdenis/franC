# Safe to spend

One number: how much you can still spend until the end of the month without breaking anything ("Reste à vivre" in French).

## Using it

The first section of Home, **Reste à vivre**, framed like a banknote's value panel (night-blue card with a thin border and inner rule, faint rosettes and a "50" watermark; Slice 57):

- "Until 30 Sept" (a small heading) and a **"Day 15 / 30"** chip.
- The amount, rounded to the euro, in the engraved serif (sand colour).
- **"9 918 francs"** under it, small and muted, right-aligned with the amount: the same amount in old francs at the legal rate 1 € = 6,55957 F, rounded to whole francs (`centsToFrancs` in `src/lib/money.ts`, integer maths). Not adjusted for inflation. "9,918 francs" in English.
- **Per day**: "About €41 a day for the next 15 days" (today counts), or "About €41 for today" on the last day. Hidden when the amount is 0 or less.
- The **month chart** (`pace-chart.tsx`): a solid line for what has been spent so far this month (cumulative outflows of the counted accounts, transfers excluded; `getDailySpending` + `buildPaceSeries`), a dashed line for the even pace (from 0 on day 0 to spent so far plus what is left, so spending evenly from now on lands on zero left), a dot for today and the dates under it. Decorative (`aria-hidden`): the text says the same.
- **How is this worked out?** opens the breakdown in a bottom sheet (a dialog on a computer, in the 50 F look). A summary card gives the amount and a bar showing how the balance splits: kept for next month (hatched Periwinkle), bills still due (hatched Sand), budgets left (Periwinkle) and what is left (Sand). Below, a receipt, one line per part, each with the swatch of its segment; tap a line to open its list: **Balance**, **− Kept for November** (opens by default when it has rows), **+ Income expected** (only when something counts now), **− Bills still due**, **− Budgets left**, **= Safe to spend**. Amounts to the cent. A card at the bottom explains the rule and links to Regular payments, where the switch is. The **Kept for** line and the card show only once at least one regular income is switched on.
- **Negative**: the amount turns amber (red is never used) and an amber line with an icon says "€40 short until 30 Sept".
- **From the 28th**: "October: +€1,323 expected", next month's forecast net (the same number as on Plan), linking to the Next month page (`/budget/next-month`).
- "Based on your balance on …" when the balance isn't today's, and the accounts left out for lack of a starting balance.

With no counted account that has a starting balance, a one-line prompt replaces the card.

**More > Preferences > Income** chooses which month incoming money counts for (see below). Untick **Count in safe to spend** on an account in More > Accounts to leave it out (e.g. savings).

## How it works

Pure and in integer cents (`buildSafeToSpend`):

> **safe to spend** = balance − income received this month + confirmed recurring income still due on the 1st–7th − recurring bills still due − what's left in each budget

(with the setting on "For the month it arrives", the old formula: balance + all confirmed income still due − bills − budgets.)

- **Balance**: the current balance of counted accounts that have a starting balance. Others are left out and named. The dashboard account filter is ignored.
- **Still due**: occurrences from each account's `asOf + 1`, or from the start of the current month when that is earlier, to the end of the current month (Europe/Paris), from the same projection as the forecast. Payments expected between your last import and today count as due. So does a payment expected on or before `asOf` that has not come yet (due today but not booked, or late): occurrences are always after the item's last seen payment, so it is not in the balance; the card says "Based on your balance on …" when `asOf` isn't today. A bill already paid this month is in the balance and its item has moved on, so it isn't counted twice.
- **Bills**: confirmed and detected outflows (detected ones marked).
- **Keep for next month** (Slice 76, `recurring.keeps_for_next_month`, off by default): a switch in the sheet of a confirmed regular income (Regular payments; not on detected items or outflows). Slice 75 applied the rule to all income through a Plus setting; that setting is gone. For a switched payment, `getReceivedIncome` lists its charges booked this month on the counted accounts (internal transfers and ignored rows excluded); they are subtracted as "kept for next month" (`heldCents`). **Leeway**: a charge dated on the 1st–7th (`LEEWAY_LAST_DAY`, `inLeeway`) is not held, so a salary paid up to a week late funds its own month. A switched payment still due counts only on the 1st–7th (`countsNow`); a later one is listed in the held section ("Salary expected on 28 Oct · counts for November") and not counted. Every other income (not switched, one-offs, unlinked rows) counts at once, as before Slice 75. `users.income_month` is no longer read. The Budget page's balance projection still uses every income due.
- **Paid with next month's money** (Slice 79, `transactions.paid_from_next_month`, off by default): a switch in a transaction's sheet ([Transactions](transactions.md)) for an expense paid with the income kept for next month. `getPaidFromNextMonth` lists this month's switched outflows on the counted accounts (transfers and ignored rows excluded); `buildSafeToSpend` adds them back (`paidNextCents`): `safe = balance − held + paid next + income − bills − budgets left`. A switched row in a budgeted category also leaves that budget's spent for the reserve, so it is not counted twice. `getDailySpending` leaves switched rows out, so the hero chart doesn't jump. No cap: if the salary hasn't come yet, the expense still belongs to next month. Without a kept income the switch is hidden and switched rows count normally. Next month needs nothing: on the 1st the hold ends and the balance already lacks the expense. Budgets, Bilan, Opérations and exports still show it in its real month. In the receipt, **Kept for {month}** shows what is kept minus these expenses (positive if they exceed it) and lists each as "Already spent: {label} · {date}"; the bar's kept segment shrinks the same way.
- **For next month** (Slice 79, SPEC §87 D9): the same column on money taken back from savings. `getPaidFromNextMonth` also lists switched inflows that are the incoming leg of an internal transfer from an account left out of safe to spend (Savings or switched off; `inFromUncountedAccount` in `src/db/queries/transfer-sql.ts`). `paidNextCents` is `Σ −amountCents`, so such a top-up is added to what is kept instead of this month's safe to spend. It never touches a budget. The receipt lists it as "Received for {month}: {label} · {date}". With the fees switched on and the top-up switched too, safe to spend is what it was before the fees.
- **Income**: confirmed only (a [tracked](recurring.md#tracked-payments-source--manual) salary counts with its expected amount, the median of its last 6 payments); the breakdown mentions detected incomes left out and links to Recurring.
- **Per day** (`perDayCents`, `src/lib/safe-to-spend/per-day.ts`): `floor(safe / days left)`, where days left = days in the month − today's day + 1; none when safe ≤ 0. `monthProgress` gives the bar's day and month length, `showsNextMonth` is true from the 28th. All string arithmetic on `YYYY-MM-DD`.
- **Budgets**: each top-level budget reserves `max(0, available − spent − bills still due in it)`. A due bill is taken out of the budget covering its category, so rent with a Housing budget counts once. Over-budget categories reserve 0 (the overspending is already out of the balance). Unbudgeted spending reserves nothing. Rollover carries count in `available`.

## Known limitation

A standing order to savings is an internal transfer, not a recurring bill, so safe to spend is too high by that amount until it leaves.

A Savings account is always outside safe to spend: switching to Savings turns "Count in safe to spend" off (Slice 52).

## Code

- `src/lib/safe-to-spend/compute.ts`
- `src/lib/safe-to-spend/per-day.ts`, `pace-series.ts`
- `src/app/(app)/home/pace-chart.tsx`
- `src/app/(app)/safe-to-spend-hero.tsx`, `safe-to-spend-breakdown.tsx`, `safe-to-spend-sheet.tsx`
- `getPaidFromNextMonth` in `src/db/queries/dashboard.ts`, `setPaidFromNextMonth` in `src/db/queries/transactions.ts`, `hasKeptIncome` in `src/db/queries/recurring.ts`, `setPaidFromNextMonthAction` and the switch in `src/app/(app)/transactions/transaction-sheet.tsx` (Slice 79)
- `setKeepsForNextMonth` in `src/db/queries/recurring.ts`, `setKeepsForNextMonthAction` in `src/app/(app)/recurring/actions.ts`, the switch in `recurring-sheet.tsx`, `getReceivedIncome` in `src/db/queries/dashboard.ts`
- Migrations `0017_safe_to_spend` (`accounts.in_safe_to_spend`), `0040_income_month` (`users.income_month`, now unused), `0041_keeps_for_next_month` (`recurring.keeps_for_next_month`, default off, no row rewritten), `0042_paid_from_next_month` (`transactions.paid_from_next_month`, default off, no row rewritten)

## Tests

`src/lib/safe-to-spend/compute.test.ts` (mid-month, bills already paid, over-budget, no budgets, kept payments: held, leeway, due income, detected note), `src/db/queries/dashboard.test.ts` (received income of the switched payments), `recurring-keeps.test.ts` (the switch: user scoping, confirmed incomes only), `per-day.test.ts` (month lengths, last day, negative), `pace-series.test.ts`, `src/lib/money.test.ts` (francs); `e2e/safe-to-spend.spec.ts` (the breakdown sheet and its folds), `e2e/keep-for-next-month.spec.ts` (the switch sticks, Home shows "Kept for"); Slice 79: `compute.test.ts` ("expense paid with next month's money": added back, budget reserve, no kept income, no cap), `dashboard.test.ts` (switched rows listed and left out of the pace, user scoping), `recurring-keeps.test.ts` (`hasKeptIncome`), `e2e/paid-from-next-month.spec.ts` (switch only on the expense, sticks, Home's "Already spent" line and +1 800 €); D9: `compute.test.ts` (incoming transfer added to what is kept, never a budget), `dashboard.test.ts` (listed only when it comes from an account left out), `e2e/paid-from-next-month.spec.ts` (no switch on a plain inflow, "For {month}" after "Take back from savings", Home's "Received for" line).

## Related

[Bank accounts and balance](accounts-and-balance.md) · [Budgets](budgets.md) · [Recurring](recurring.md) · `SPEC.md` §42, §52, §72, §87
