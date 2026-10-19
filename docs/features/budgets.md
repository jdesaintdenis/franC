# Budgets

A monthly spending target per category, with optional rollover, one-click presets, and a warning before you go over.

## Using it

**Plan > Budgets** (`/settings/budgets`, reached by **Edit** on the Budget page; 50 F look, Slice 60) shows a card "€1,250 planned a month · 8 budgets" with the gauge legend, then the rows in the Budget page's shape (tile, name, "€65 of €120" with the amber over / fast-pace notes, big %, ten-block gauge with the pace tick), each with a ⋯ menu, and a full-width **Add a budget** button above the tab bar. It lists **only the categories you've budgeted**, parents with their budgeted subcategories nested, sorted like Home (over, on pace to go over, then by name). Under the header, "€X left of €Y · N days to go" (the Plan numbers). Each row has this month's bar with the pace tick and "€65 of €120", and "Rolls over · €70 carried" when rollover is on. The "subcategory budgets exceed the parent" warning stays under the parent.

- **Tap a row** (or ⋯ > Edit) opens the **edit sheet** (`?edit=<categoryId>`; a category without a budget gets a new one, and `&amount=<cents>` pre-fills it, as a regular payment's sheet does): the amount field (`400`, `400,50`, `400.50`), chips **Use average · €X** and **Last month · €X** that fill it in one tap, a **Roll over** switch with its carry, **Save** and **Remove budget**. An empty amount is refused; removing is the button's job. Saving with rollover turned off says in the toast that the carry was reset.
- ⋯ > **See transactions** opens the category's outflows for this month; ⋯ > **Remove budget**.
- **Remove** is immediate with a "Budget removed · Undo" toast. Undo (`restoreBudget`) restores the exact row (amount, rollover, `rollover_start`, `rollover_base_cents`), so a carry survives an accidental removal; it replaces a budget set again for that category in the meantime.
- **＋ Add a budget** (`?add=1`): the categories without a budget, sorted by 3-month average spending ("€1,358 a month on average", or "No spending yet"), subcategories under their parent (a budgeted parent heads them without being selectable), with a search field above 10 items. Picking one opens the edit step with the average prefilled; Back returns to the list.
- **No budgets yet** (the shared empty state): one sentence, the Add button and the top 3 suggestions (with spending), each one tap from its edit step. The welcome checklist's "Set a first budget" and the "Set monthly budgets" row on Home and Plan open `?add=1`.

The **Budget page** (`/budget`, [Budget page](budget-page.md)) shows the selected month's budgets in Home's ten-block rows (a past month shows its final state), with an **Edit** link; with no budget it offers **Set monthly budgets**. A rollover deficit reads "{spent} spent · {carry} carried over behind", never a negative "of".

**Home > Budgets**: for the selected month, over-budget first, then on pace to go over; the top 3 show, "See all N budgets" reveals the rest, and on the current month each bar has a thin pace marker at today's share of the month. Over-budget and ahead-of-pace budgets also appear in Home's "Needs attention" list. Each row reads "€65.00 of €120.00" with a bar, "Budget €50.00 + €70.00 carried over" when rolling over, and links to that category's outflows for the month.

## How it works

### Amounts and roll-up

- `category_budgets (category_id PK, amount_cents > 0, rollover, rollover_start, rollover_base_cents)`, max 10 000 000 € per budget. Deleting the category deletes its budget.
- **One amount for every month**: there is no history, so changing a budget changes how past months read too (rollover snapshots protect carried amounts, see below).
- A **parent's budget** covers rows on the parent and its subcategories. A **subcategory budget** is a limit inside its parent's, never added on top. "Total budgeted" = parent budgets + subcategory budgets whose parent has none. The Budgets page warns (without blocking) if subcategory budgets exceed the parent's.

### Spent

Outflows only (a refund doesn't free budget), split rows per part, internal transfers and [ignored](transactions.md#ignoring-a-transaction) transactions excluded, uncategorized not budgetable. Computed in SQL (`getBudgetProgress`). Budgets always count **all accounts**.

### Status

- **Over**: spent > available.
- **Near**: spent ≥ 90% of available.
- **On pace to go over** (see below).
- Otherwise on track.

### Rollover

- Off by default. Starts the month it's turned on, with a carry of 0 (no backdating).
- **Carry** into a month = base + Σ (budget − spent) over every month from `rollover_start` to the previous month. Leftovers add up; overspending subtracts with no floor, so the carry can be negative. Months with no spending count as fully unspent.
- **Available** = budget + carry; status, remaining, the bar and total budgeted use it.
- Changing the amount while rollover is on **snapshots** the carry into `rollover_base_cents` and moves the start to this month, in one transaction, so the new amount never rewrites past months.
- Turning rollover off resets the carry (the save says so).
- A subcategory budget with rollover carries inside its parent, never added to it.

### Presets

Budgets keep no history, so both presets come from spending (rolled up like budgets), rounded **up** to the euro:

- **Last month**: the previous full month.
- **3-month average**: the 3 full months before this one, divided by fewer months if your first transaction is more recent. A preset of 0 is hidden.

### Pace warning

Current month only, from the 5th. A budget not yet over is flagged "On pace to go over" when:

> recurring charges already paid + bills still due in it + other spending × days in month ÷ day of month > available

Charges linked to a recurring item aren't extrapolated, so rent on the 1st doesn't trip it. Integer cross-product in BigInt.

### Regular payments inside a budget (Slice 66)

A budget counts the regular payments of its category and its subcategories (`chargesByEntry`): the charges already made this month (transactions linked to a recurring item) and the bills still due (the same list as "Factures à venir", `safeToSpend.bills`).

- **Gauge**, in order: paid payments (solid sand), other spending (periwinkle; amber when over or ahead of pace), payments still due (hatched sand), capped at 100 % (`gaugeSegments`). The big percentage is still the real spending.
- **Pace tick on the rest**: it starts after the paid payments and leaves room for the due ones (`restPaceTickPercent`); without payments it is the plain even pace.
- **Detail line** adds " · X à venir" when payments are due. **Left to spend** under the gauge (current month, every budget not over, with or without payments): `available − spent − due`; "Tout est prévu : plus rien à dépenser" at zero, amber "X de trop avec les prélèvements à venir" below zero.
- **Payments-only budget** (`isChargesOnly`): payments cover at least 95 % of the amount (`CHARGES_ONLY_PERCENT`) and the budget is not over. Home leaves it out; the Budget page folds it under "Voir les N budgets de prélèvements"; this settings list shows every budget.
- **Budget sheet**: a "Prélèvements X €" pill first (this month's payments of the category, rounded up to the euro, `chargesPresetCents`) and a note naming up to three of them.
- A past month shows paid payments only, with no tick and no left-to-spend line.

### Safe to spend

Each budget reserves `max(0, available − spent − bills still due in it)` (see [Safe to spend](safe-to-spend.md)).

## Code

- `src/lib/budgets/charges.ts` (regular payments of a budget), `progress.ts`, `rollover.ts`, `presets.ts`, `pace.ts`, `amount.ts`, `input.ts` (pure)
- `src/lib/budgets/suggestions.ts` (Add-a-budget list order and grouping), `snapshot.ts` (Undo snapshot schema)
- `src/db/queries/budgets.ts` — `getBudgetProgress`, `getRecurringCharges`, presets, `removeBudget` (returns the snapshot), `restoreBudget`
- `src/app/(app)/settings/budgets/` (`budgets-screen.tsx`, `edit-budget-sheet.tsx`, `add-budget-sheet.tsx`, `budget-form.tsx`), `src/app/(app)/budget-progress.tsx`, `src/app/(app)/home/budget-gauge-row.tsx`, `block-gauge.tsx`, `budget-charge-lines.tsx`, `charges-only-fold.tsx` (the row shared by Home, the Budget page and this list), `src/components/manage/bottom-add-button.tsx`
- Migrations `0009_category_budgets`, `0018_budget_rollover`

## Tests

`src/lib/budgets/*.test.ts` (roll-up, over/under, rollover across months, negative carry, presets, pace, suggestions, snapshot), `src/db/queries/budgets.test.ts` (remove and restore); `e2e/budgets.spec.ts` (empty state → add from a suggestion → edit → remove and Undo); `e2e/budget-charges.spec.ts` (due and paid payments, left to spend, payments-only budgets folded, sheet pill, past month); `charges.test.ts`, `home-lists.test.ts`; `e2e/lists-50f.spec.ts` (over budget reads amber on Settings > Budgets and Budget, no red anywhere).

## Related

[Categories](categories.md) · [Dashboard](dashboard.md) · [Safe to spend](safe-to-spend.md) · `SPEC.md` §30, §43, §57
