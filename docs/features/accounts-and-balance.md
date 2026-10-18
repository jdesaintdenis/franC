# Bank accounts and balance

You can track several bank accounts, see each one's current balance, and get a 30-day projection that warns you before an overdraft. On an account fed by [bank sync](bank-sync.md), the balance is the bank's own, and franC tells you when its transactions don't add up to it.

## Using it

**Accounts** (the fourth tab, `/accounts`, in the 50 F look, Slice 61 / SPEC §76): a **total card** ("On your accounts": all balances added up, then "Current … · Savings …" when both kinds exist; hidden when no account has a balance), then **Your accounts**: one row per account with a tile (bank or piggy bank), its name, a caption and the balance on the right (or **Add a balance** in periwinkle). The caption is "<bank> · synced 2 Oct 07:00" for an account a bank feeds, "CSV · imported 28 Sept" (or "never imported") for the others, amber when the import reminder says the account is overdue, and for a Savings account its moves and what its goals hold. Tapping a row opens the account sheet. **Add account** is a full-width button at the bottom. Below: **Bank sync** and **Imports** ([Bank sync](bank-sync.md), [Import reminder](import-reminder.md)).

- **Create, rename, delete** accounts. Names are trimmed, 1–50 characters, unique per user ignoring case.
- **Delete** keeps its confirmation (no Undo: the transactions go with it) and asks and tells you how many imports and transactions will go (and which savings goal is linked, if any). The **last account can't be deleted**, since imports need somewhere to go: its menu item reads "Delete (your only account)" and is disabled.
- **Starting balance** (button **Save balance**): a starting balance (amount with sign), the date it applies from, and an optional "Warn me below" threshold. **Remove starting balance** also resets the threshold to 0.
- **A balance from the bank**: on a connected account that has been synced, the amount and date fields are replaced by a read-only line, "€1,234.56 · From Caisse d'Épargne, 2 Oct 07:00" (the time franC read it, in Paris time). **Warn me below** stays editable (its own **Save** button); **Remove starting balance** and the Starting balance menu item are hidden, and the server refuses to set or clear the amount (`bankBalance` error) for such an account. A connected account that hasn't been synced yet keeps its manual balance form, with "The bank's balance replaces it at the next sync". After a disconnect the account is manual again (see below).
- **Gap with the bank**: when franC's transactions don't add up to the bank's balances, the account sheet shows a "Gap with your bank" block with the same sentence, buttons and wording as Home's Needs attention row (below).
- **Count in safe to spend** checkbox (on by default): untick it for a savings account (see [Safe to spend](safe-to-spend.md)).
- **Remind me to import** checkbox (on by default, with several accounts): untick it for an account you only import now and then (see [Import reminder](import-reminder.md)).

- **Default account** (with several accounts): ⋯ > **Set as default** makes **This month** open on that account instead of All accounts (Home always covers every account); its row says "Default · Home opens on this account". The account buttons on This month still switch (see [Dashboard](dashboard.md)). Stored in `users.home_account_id` (migration `0031_home_account`, nullable, cleared when the account is deleted).

Account selects, labels and links only appear once you have more than one account.

**Dashboard > Balance card** (above the month selector, since it is about now, not the selected month):

- Today's balance per account, plus a Total row when you have several.
- On the **Budget page** (`/budget`, [Budget page](budget-page.md#solde-every-month)), the **Balance** card draws the selected month's balance day by day (real, then dashed to the month's end on the current month), with its end-of-month figure, a step chart with its lowest and highest values on the axis, the threshold drawn as a dashed amber line, and the lowest point marked with a dot. Hovering with a mouse, or tapping or dragging a finger along the chart, shows that day's balance in the shared chart tooltip (see [Dashboard](dashboard.md#charts)); under the chart, "Lowest €316 · 20 Oct" and the legend "Alert below €300". With several accounts each one gets a row.
- For an account whose balance comes from the bank the line under the figure reads "From your bank, 2 Oct 07:00" instead of "Balance on …" / "Balance today" (in each account's row when there are several).
- On Home, **Comptes**: every account with its balance and when it was read (Slice 57, [Dashboard](dashboard.md#layout)).
- A row in Home's "Needs attention" list when an account's transactions don't match the bank's balance (below), and a row when an account will go below its threshold ("Main account goes below €300 on 20 Oct", naming the payment that causes it), or first in that list when it already is.

## How it works

### Balance checkpoints

A balance is stored as **checkpoints** (`balance_checkpoints`): "the balance was X at the **end** of day D". There is at most one **manual** checkpoint per account (the starting balance the user typed; "balance at the start of day D" is stored as the end of D − 1, so the figure shown is the same as before checkpoints existed) and one **bank** checkpoint per account and day (the booked balance read at each sync, with the bank's name, when franC read it, the balance type and an `accepted_gap_cents` note). The starting date can't be later than tomorrow (Europe/Paris), tomorrow being allowed so a balance restored from a bank checkpoint of today can be saved again. Migration `0029_balance_checkpoints`, `0032_savings` creates the table and copies every existing starting balance into a manual checkpoint; `accounts.starting_balance_cents` and `starting_balance_date` stay in place, unread, until a later cleanup migration drops them (SPEC §64).

### Current balance

`getAccountBalances` (one query, which feeds the Balance card, the projection, warnings, Safe to spend, Plan and Goals) picks one **anchor** per account:

- **Connected account with a bank checkpoint**: its latest bank checkpoint + the sum of non-ignored transactions **booked after** its day (`coalesce(booked_on, date) > checkpoint date`). The bank's balance only holds booked rows, so a card payment made on 1 Oct and booked on 3 Oct isn't counted until it is booked. `source` is `bank`, with the bank's name and when it was read.
- **Any other account** (not connected, or connected but not synced yet): the manual checkpoint + the sum of non-ignored transactions dated after it, exactly as before. `source` is `manual`.

[Ignored](transactions.md#ignoring-a-transaction) transactions are left out. Internal transfers are ordinary rows here (they lower one account and raise the other), so the total across accounts is unaffected.

The balance is known up to `asOf`: the anchor's day, or the latest counted transaction's. The card says "Balance on 14/09/2026", or "today" when that is today; for a bank balance it says "From your bank, 2 Oct 07:00".

### Gap check (connected accounts)

`findBalanceGap` (`src/lib/balance/gaps.ts`, pure) tells whether franC's transactions agree with the bank. The series starts at the **manual starting balance** (the first checkpoint) and continues with the bank checkpoints in date order; for each, the **running difference** = the bank's change since the start − franC's movement booked in between − the gaps already accepted. A difference that returns to 0 raises nothing, so a row booked a day off cancels out. Otherwise the gap is the current difference, between the day after the last checkpoint where franC agreed and the first checkpoint after which the difference stayed as it is (an old gap from 3 to 9 Sept still reads "3 and 9 Sept" a month later). Only connected accounts are checked; a disconnected one raises nothing. Bank checkpoints at or before the starting balance's day are ignored.

**Sign and wording**: the amount is the bank's change minus franC's movement. **Negative** = the bank shows **less** than franC adds up to (typically spending missing in franC); **positive** = the bank shows **more**. It is worded neutrally from the sign with the absolute amount: "Main account: your bank shows €42.10 less than franC between 3 and 9 Sept" / "…€42.10 more than franC…". A single-account user doesn't see the account name.

On Home the row opens a sheet with one sentence of explanation and two buttons:

- **Import a CSV for those dates** → `/import?account=<id>`; once the rows are in, the gap closes by itself.
- **Accept the bank's balance** stores the current difference in `accepted_gap_cents` on the latest bank checkpoint (`acceptBalanceGap`), then a toast offers **Undo** (`restoreBalanceGap` puts the previous value back). It is a **note on the checkpoint, not a transaction**: spending totals, budgets and the year view don't move, and nothing appears in the transactions list. Both are scoped by `user_id`.

### Disconnecting

Disconnecting a bank copies each linked account's latest bank checkpoint into its manual checkpoint (replacing the old starting balance), so the account keeps its last bank balance and it is editable again. Bank checkpoints stay as history. The disconnect dialog says so. Because a checkpoint is the end of a day, the restored starting balance reads as starting on the **next** day (a bank balance of 2 Oct is the balance at the start of 3 Oct), so the date field accepts tomorrow as well as today.

### 30-day projection

- Built from recurring items (confirmed and detected; detected ones are marked "Detected"), using the same occurrence projection as the forecast, so cadences, month-end clamping and dismissed or ended items behave the same way. Items with an open price alert keep their usual amount.
- The projection starts the day after `asOf`, so payments expected between your last import and today are counted, and the card says how many ("Includes N payments expected since your last import").
- **Lowest point** = the earliest day with the minimum balance.

### Warnings

- Per account, against that account's own threshold (default 0).
- Fires on the first day the balance is **strictly below** the threshold (exactly at it does not warn). It names the largest outflow of that day ("and N more" for others), or says "already below" when the balance at `asOf` is under it.
- The Total row has no threshold: an overdraft happens on one account even if another has money.

### Accounts without a starting balance

They are left out of the projection and the total, and named on the card with a link to Accounts. If no account has one and there are transactions, a one-line prompt replaces the card.

### Account filter

This month and Regular payments have a row of account links that set `?account=<id>`. It filters the balance card, totals, charts, trend, Coming up and the forecast. Next month and Year have none: they always cover every account. Budgets, Safe to spend and Goals always cover all accounts.

### Deleting an account

One DB transaction removes its imports, transactions, recurring items, transfer pairs and splits (FK cascades). The goals kept in that account keep their money and become goals tracked by hand (Slice 55). Transfer and recurring detection re-run afterwards.

### Account type: Current or Savings (Slice 52)

Each account is **Current** (default) or **Savings**, set in the account sheet (**Account type**). Creating an account is unchanged.

- A Savings account takes **no CSV import and no bank link**: the Import page and Bank connection don't offer it, and the server refuses it. Its money comes from **Move to savings** ([Internal transfers](internal-transfers.md#move-to-savings)).
- Switching to Savings is refused when the account already has imported or synced transactions or a bank link, or when it is the only Current account (imports need somewhere to go). It also turns "Count in safe to spend" off. Switching back to Current is refused while the account holds rows franC created.
- The Import reminder and its freshness check ignore Savings accounts. A Savings account can always be deleted; the last Current account can't.
- The sheet lists the account's **Automatic moves** (savings rules) with Remove and Undo. The list row says how many moves it holds.
- Its balance is the usual starting balance plus the rows franC created.
- The sheet also lists the goals kept in the account with what each holds and **Not assigned** (the balance minus what they hold), with a link to Manage goals ([Savings goals](savings-goals.md)).
- Storage: `accounts.savings` (migration `0032_savings`).

## Known limitation

None known. Standing orders from a Current account to a Savings account are now detected ([Recurring payments](recurring.md)); standing orders between two Current accounts are still internal transfers and aren't.

## Accounts with hand rows (Slice 56)

Hand rows can be added to any Current account. An account that holds hand rows can't be switched to Savings (`hasManual`), because they were never meant for a Savings account. The balance gap check ignores hand rows still waiting for the bank, since the bank balance doesn't include them yet.

## Code

- `src/lib/accounts/totals.ts` (`accountTotals`), `src/app/(app)/accounts/` (`accounts-total.tsx`, `bank-sync-section.tsx`, `imports-section.tsx`) — Accounts UI and actions (`accounts-screen.tsx`, `account-sheet.tsx`, `delete-account-dialog.tsx`)
- `src/app/(app)/balance-card.tsx`, `balance-chart.tsx` — dashboard card
- `src/lib/accounts/` — name validation, default account
- `getHomeAccountId` / `setHomeAccount` in `src/db/queries/accounts.ts`, `setHomeAccountAction`, `resolveHomeAccount` in `src/lib/dashboard/account.ts`
- `src/lib/balance/input.ts` — form validation
- `src/lib/balance/projection.ts` — `buildBalanceOverview` (pure)
- `src/lib/balance/gaps.ts` — `findBalanceGap` (pure)
- `src/db/queries/accounts.ts`, `src/db/queries/balance.ts` — `getAccountBalances`, `isBankBalanceAccount`, `setAccountThreshold`; `src/db/queries/balance-checkpoints.ts` (save, manual upsert, promote on disconnect); `src/db/queries/balance-gaps.ts` (`getBalanceGaps`, `acceptBalanceGap`, `restoreBalanceGap`)
- `src/app/(app)/accounts/bank-balance-form.tsx` — the read-only bank line and the threshold-only form; `src/app/(app)/balance-gap-panel.tsx`, `balance-gap-row.tsx`, `balance-gap-actions.ts` — the gap sheet, its buttons and actions
- `src/lib/format-date.ts` — `formatShortInstantTime` ("2 Oct 07:00", Paris time)
- `src/lib/dashboard/account.ts` — account filter parsing
- Migrations `0007_multiple_accounts`, `0013_account_balance`, `0017_safe_to_spend`, `0029_balance_checkpoints`

## Tests

`src/lib/balance/*.test.ts`, `src/lib/accounts/*.test.ts`, `src/db/queries/balance.test.ts`, `src/db/queries/multi-account.test.ts`, `src/db/queries/balance-checkpoints.test.ts` (migration copy, bank anchor, same-day upsert, disconnect, gaps, accept and undo), `src/lib/balance/gaps.test.ts`, `src/lib/dashboard/attention.test.ts`, `src/lib/format-date.test.ts`; `e2e/accounts.spec.ts`, `e2e/savings.spec.ts` (account type, Move to savings, rules), `e2e/home-account.spec.ts` (Set as default, Home opens on it, All accounts, Remove as default), `src/lib/dashboard/account.test.ts` (`resolveHomeAccount`), `balance.spec.ts`, `bank-balance.spec.ts` (read-only bank balance after Sync now, the gap on Home with Accept and Undo, editable balance after disconnect).

## Related

[Bank sync](bank-sync.md) · [Recurring payments](recurring.md) · [Safe to spend](safe-to-spend.md) · [Savings goals](savings-goals.md) · [Internal transfers](internal-transfers.md) · `SPEC.md` §28, §38, §64

Loans (Accounts > Crédits) sit under the accounts but are not accounts: see [Loans](loans.md).
