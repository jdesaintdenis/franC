# Dashboard

The home screen (`/`) is a short summary of where the accounts stand **today**, in the 50 F look (Slice 57, `SPEC.md` §72): how much can still be spent, what needs attention, the accounts, the budgets and the goals. Nothing is done here; every row links to where it is done. The month views (totals, categories, trend, balance chart, Coming up) moved to the [Budget page](budget-page.md).

## Layout

**Welcome checklist** (new users, Slice 62): until it is finished or hidden, a **Get started** section comes first (title and "2 of 4" on one line), with a four-square gauge and four steps that tick themselves from your data, in this order: **Connect your bank** (only for emails in `BANK_SYNC_EMAILS`; done once a bank account feeds an account or any transaction exists; "or import a CSV statement" is a second link under it) or **Import your bank export** for everyone else (any transaction), **Enter your balance** (any account has a starting balance; with a bank it ticks by itself after the first sync), **Validate your transactions** (imported and nothing left to review) and **Set a first budget** (any budget). Each row links to the page that does it (`/accounts/bank` or `/import`, `/accounts`, `/review`, `/settings/budgets`); the next undone one is highlighted in periwinkle, finished ones are faded with a mint tick. Before the first import, the checklist and a one-line welcome are the whole page. While it shows, the safe-to-spend prompt and the "to review" row of Needs attention are hidden, since the checklist asks for those. When all steps are done, Home records `users.welcome_completed_at` and the card never comes back, even when a later import leaves rows to review; **Hide this guide** (under the card) records the same. Users who had transactions before this feature (migration 0025) never see it.

**Phone, top to bottom.** Each section is a titled card (Cinzel capitals); Home has no search params.

1. Header: "Home" in Cinzel, with the **"Data up to …"** line (all accounts) as its caption ([Import reminder](import-reminder.md)), then the bank sync line.
2. **Reste à vivre** / Safe to spend: the value-panel hero ([Safe to spend](safe-to-spend.md)): "Until 31 Oct" and a "Day 5 / 31" chip, the amount, **"9 918 francs"** under it, the per-day line, the month chart and "How is this worked out?".
3. **À traiter** / Needs attention, hidden when empty (see below).
4. **Comptes** / Accounts (`id="balance"`): every account with its balance and a freshness line ("From your bank, 07:02", "Balance today", "Balance on 3 Oct"). A row opens that account's transactions; an account without a balance shows "Add a balance" and opens Settings > Accounts.
5. **Budgets**: the current month's top 4 (over first, then ahead of pace, then most used): name, "€312 of €450", a ten-block gauge with a white tick at today's share of the month, and a big percentage. Over or ahead of pace is amber ("fast pace", "€40 over"). The header link reads "Budget" (or "All 6 budgets" when more exist) and opens Plan. With no budget but some categories, one "Set monthly budgets" link; with no categories the section is hidden. Code: `homeBudgets`, `budgetPercent`, `gaugeBlocks`, `paceTickPercent` in `src/lib/dashboard/home-lists.ts`.
6. **À venir ce mois-ci** / Coming up this month, under Budgets, when the Reste à vivre hero shows (Slice 65, see below).
7. **Objectifs** / Goals, when you have any: the top 4 by `compareGoals`, same row shape without the pace tick; header link "All goals" → Settings > Goals.

**Desktop (from 1024 px)**: two columns. Left: Reste à vivre, À traiter. Right: Comptes, Budgets, À venir ce mois-ci, Objectifs. The sidebar and the bottom bar wear the 50 F look while on Home.

**The look** (`.theme-50f`, `.bg-50f`, `.hero-50f` in `globals.css`): dark whatever the theme setting; background `#04051a` with faint rosettes and stars, solid cards `#121638`, periwinkle `#8ea2ff` for links and gauges, sand `#f3e3a6` for the hero amount only, amber `#ffb05a` for warnings. **Red is never used**: `--destructive` maps to amber inside the class. Manrope for text and numbers, Cormorant Garamond (700) for the hero amount only, Cinzel for titles; self-hosted through `@fontsource` packages. Other pages keep the Tricolore look until a later slice ([Language and theme](language-and-theme.md)).

## How it works

### Needs attention

One list, most urgent first, built by `buildAttention` (`src/lib/dashboard/attention.ts`, codes and params only):

1. An account **already below** its alert level.
2. **Balance gap**: a connected account whose transactions don't add up to the bank's balances, one row per account ("Main account: your bank shows €42.10 less than franC between 3 and 9 Sept"; single-account users see no name). It opens a bottom sheet instead of a page: one sentence of explanation, **Import a CSV for those dates** (→ `/import?account=<id>`) and **Accept the bank's balance** (a note, not a transaction; the toast has Undo). See [Bank accounts and balance](accounts-and-balance.md#gap-check-connected-accounts).
3. **Stale import** (one row, whatever the number of accounts) → Import.
4. **Transactions to review** → Review.
5. **Price increases** (open price alerts): one row per alert up to 2, each opening that item's sheet (`/recurring?item=<id>`); one "3 prices went up" row from 3 → Regular payments.
6. **Backup failing** (only for emails in `BANK_SYNC_EMAILS`, i.e. the deployment's owner): "Backup failing since 17 Oct", right after the bank rows, from the first failed night until one succeeds. It is not a link (nothing in the app fixes it; the line says to read the daily job's logs on Vercel). Testid `attention-backup-failing`; data from `backup_status`.
7. **Low balance ahead**: an account that will go below its alert level in the next 30 days, with the date and the payment → the Balance card on This month.

Budgets over or ahead of pace never get a row: the Budgets section below already shows them (amber gauge, "fast pace", "€40 over"; `SPEC.md` §84).

Each row is one full-width link (the gap row is a button that opens its sheet) with a tinted icon, a title and a muted line. The first 3 rows show; with more, **See all (N)** expands the rest in place. A price increase reads "Netflix ~~€13.49~~ €15.99": the old price struck through and muted, the new one in amber, no second line. Home covers all accounts, so price alerts are never filtered either. "Low balance ahead" and "already below" open `/budget#balance`, where the balance curve is.


### Coming up this month (Slice 65)

A card under Budgets answers "is a big payment still to come?" (`SPEC.md` §80). It shows the bills the Reste à vivre sheet subtracts (`safeToSpend.bills`: outgoing recurring payments, detected or confirmed, on counted accounts, from the start of the month, or the day after an older balance date, to the end of the month; a payment due on or before the balance date that has not come yet stays due), so its total always equals the sheet's "bills still due" line. Income is never shown. It appears only with the hero (never with the "set a starting balance" prompt); with no bill left it shows "Nothing left to pay this month".

- **Header**: the total and "still to pay · N bills".
- **Strip**: the month as one line, a blue tick for today and a dot per day that has a bill. The dot's size follows the day's total (8 px up to 22 px, capped at 300 €); a day with a bill of 100,00 € or more is sand, the others grey. A tap on a dot opens a bubble naming the bills of that day (in full) and of the day before and after (fainter), three lines then "+ N more". Neighbouring dots overlap on a phone, so bigger dots sit on top and their bubble covers the neighbour; a second tap, a tap elsewhere or Escape closes it.
- **Legend**: "2 of €100 or more · under €100", or "Only small bills" in mint when none is big.
- **List**: the 3 biggest bills still due, largest first (ties by date, then name); each row links to the regular payment (`/recurring?item=<id>`). A tracked estimate shows as "about".
- A bill dated before the month (balance date in the previous month) sits on day 1 of the strip; its row keeps the real date.

## Not-found hand rows in Needs attention (Slice 56)

One row, "N added by you, not found in your bank" (testid `attention-not-found`), appears right after the balance gaps when `countNotFound` is above 0, and links to Review. Built in `src/lib/dashboard/attention.ts` (`notFound` input).

## Code

- `src/app/(app)/page.tsx`; `src/app/(app)/home/`: `home-section.tsx`, `block-gauge.tsx`, `pace-chart.tsx`, `home-accounts.tsx`, `home-budgets.tsx`, `home-goals.tsx`; siblings `safe-to-spend-hero.tsx`, `safe-to-spend-breakdown.tsx`, `safe-to-spend-sheet.tsx`, `needs-attention.tsx`, `upcoming-payments.tsx`, `upcoming-strip.tsx`, `welcome-checklist.tsx` (+ `welcome-actions.ts`), `balance-gap-panel.tsx`, `balance-gap-row.tsx`, `balance-gap-actions.ts`
- `src/db/queries/dashboard.ts` (`getDailySpending` feeds the hero chart), `src/db/queries/welcome.ts` (the checklist's facts and `welcome_completed_at`)
- `src/lib/dashboard/attention.ts`, `home-lists.ts`, `upcoming-bills.ts`, `welcome.ts`; `src/lib/safe-to-spend/pace-series.ts`

## Tests

`src/lib/dashboard/*.test.ts` (attention order, the balance gap row, `home-lists`, `upcoming-bills`), `src/lib/safe-to-spend/pace-series.test.ts`, `src/db/queries/dashboard.test.ts` (`getDailySpending`); `e2e/safe-to-spend.spec.ts` (hero, francs line, pace chart, Accounts section), `e2e/bank-balance.spec.ts` (gap row, Accept and Undo), `e2e/first-run.spec.ts` (empty app to a useful Home), `e2e/goals.spec.ts`, `e2e/price-alerts.spec.ts`, `e2e/home.spec.ts`, `e2e/home-upcoming.spec.ts` (coming up card: biggest bills, dot bubble, no sideways scroll).

## Related

`SPEC.md` §49, §52, §55, §72, §80
