# Safe to spend

One number: how much you can still spend until the end of the month without breaking anything ("Reste à vivre" in French).

## Using it

The first section of Home, **Reste à vivre**, framed like a banknote's value panel (night-blue card with a thin border and inner rule, faint rosettes and a "50" watermark; Slice 57):

- "Until 30 Sept" (a small heading) and a **"Day 15 / 30"** chip.
- The amount, rounded to the euro, in the engraved serif (sand colour).
- **"9 918 francs"** under it, small and muted, right-aligned with the amount: the same amount in old francs at the legal rate 1 € = 6,55957 F, rounded to whole francs (`centsToFrancs` in `src/lib/money.ts`, integer maths). Not adjusted for inflation. "9,918 francs" in English.
- **Per day**: "About €41 a day for the next 15 days" (today counts), or "About €41 for today" on the last day. Hidden when the amount is 0 or less.
- The **month chart** (`pace-chart.tsx`): a solid line for what has been spent so far this month (cumulative outflows of the counted accounts, transfers excluded; `getDailySpending` + `buildPaceSeries`), a dashed line for the even pace (from 0 on day 0 to spent so far plus what is left, so spending evenly from now on lands on zero left), a dot for today and the dates under it. Decorative (`aria-hidden`): the text says the same.
- **How is this worked out?** opens the breakdown in a bottom sheet (a dialog on a computer): balance, income expected, bills still due (listed), budgets left (listed), result, all to the cent.
- **Negative**: the amount turns amber (red is never used) and an amber line with an icon says "€40 short until 30 Sept".
- **From the 28th**: "October: +€1,323 expected", next month's forecast net (the same number as on Plan), linking to the Next month page (`/budget/next-month`).
- "Based on your balance on …" when the balance isn't today's, and the accounts left out for lack of a starting balance.

With no counted account that has a starting balance, a one-line prompt replaces the card.

Untick **Count in safe to spend** on an account in More > Accounts to leave it out (e.g. savings).

## How it works

Pure and in integer cents (`buildSafeToSpend`):

> **safe to spend** = balance + confirmed recurring income still due − recurring bills still due − what's left in each budget

- **Balance**: the current balance of counted accounts that have a starting balance. Others are left out and named. The dashboard account filter is ignored.
- **Still due**: occurrences from each account's `asOf + 1`, or from the start of the current month when that is earlier, to the end of the current month (Europe/Paris), from the same projection as the forecast. Payments expected between your last import and today count as due. So does a payment expected on or before `asOf` that has not come yet (due today but not booked, or late): occurrences are always after the item's last seen payment, so it is not in the balance; the card says "Based on your balance on …" when `asOf` isn't today. A bill already paid this month is in the balance and its item has moved on, so it isn't counted twice.
- **Bills**: confirmed and detected outflows (detected ones marked).
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
- Migration `0017_safe_to_spend` (`accounts.in_safe_to_spend`)

## Tests

`src/lib/safe-to-spend/compute.test.ts` (mid-month, bills already paid, over-budget, no budgets), `per-day.test.ts` (month lengths, last day, negative), `pace-series.test.ts`, `src/lib/money.test.ts` (francs); `e2e/safe-to-spend.spec.ts`, `e2e/home.spec.ts` (the breakdown sheet).

## Related

[Bank accounts and balance](accounts-and-balance.md) · [Budgets](budgets.md) · [Recurring](recurring.md) · `SPEC.md` §42, §52, §72
