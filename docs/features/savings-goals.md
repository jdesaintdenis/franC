# Savings goals

Goals like "Car: €3,000 by June", with progress, the monthly amount needed, and whether you're on track. Several goals can share one account, each holding the money assigned to it.

## Using it

**Plan > Goals** (`/settings/goals`, 50 F look, Slice 60): a card "€2,300 saved of €6,000" with a sand gauge and "€310 a month to set aside to meet the dates", then the goals in Home's ten-block rows ("€1,200 of €3,000 · by hand · March 2027", amber "behind by …", mint "reached"). Each row has a **＋** (Add money, or Assign money for an account goal) and the ⋯ menu. **New goal** (button above the tab bar) opens the create sheet: name, target, optional date, emoji, and **Where the money is** as a two-way choice, **Money added by hand** or **On an account** (then one pill per account). Tapping a row opens the edit sheet, which ends with **Delete goal** (same Undo toast). The money sheet offers quick amounts (to stay on time, to finish, and for an account goal everything not assigned) and a link to turn it around (Take money out, Unassign…). With none, the page says "No savings goals yet" with **Add a goal**.

Under the summary card, one **card per account that has goals** (Slice 64): the account's balance on the right, "€2,000 assigned · €1,200 to assign" (amber while something is left to assign, "all assigned" at zero, amber "€200 more than the balance" when the goals hold more) and a sand gauge of the assigned share (`assignedPercent`; amber and full when over-assigned). An account without a starting balance shows a link to Accounts to set one, no gauge.

The ⋯ menu of a goal **kept in an account** has **Assign money** and **Unassign money** (a sheet with the amount, a date and a hint: what is not assigned, or what the goal holds), **Move to another goal** (only when another goal shares the account) and Edit and **Delete**. A goal **tracked by hand** keeps **Add money** and **Take money out**. Both sheets list the goal's recent entries, which can be removed; entries that follow a moved row show its label. Delete is immediate with **Undo**, which recreates the goal and its entries with the same ids (`restoreGoal`).

The **Budget page** (`/budget`) shows every goal in Home's row shape with a **Manage** link, then "Saved in {month}: €X" when a Savings account exists, or **Add a savings goal** when there is none. The **dashboard** Goals card (under the Balance card) shows each goal's progress, monthly amount and status; goals needing attention first, then by date, reached last. It ignores the account filter. The account sheet (**Accounts > Edit**) lists the account's goals with what each holds and **Not assigned**.

## How it works

- **Goal**: name (1–60 characters, unique per user ignoring case), target (> 0, ≤ 10 000 000 €), optional date, optional emoji.
- **A goal holds the sum of its entries** (`savings_goal_contributions`, Slice 55). An entry is one of: money added by hand (goal tracked by hand), an **assignment** (account goal, `transaction_id` null), or a **moved row** (`transaction_id` = the row on the goal's account, from [Move to savings](internal-transfers.md#move-to-savings); deleting that row, for example by undoing the move, removes the entry).
- **Several goals can share one account** (YNAB-style). **Not assigned** = account balance − what its goals hold; negative when the balance fell below what was assigned (shown, never blocked). A new account goal starts at €0.
- **Limits**: assigning is refused above Not assigned (and without a starting balance); unassigning, taking out, moving to another goal and removing an entry are refused when the goal would hold less than €0. The goal and account rows are locked so two requests can't both pass.
- **Move to savings** (a transaction's sheet) shows one button per goal under each Savings account: one tap moves the money and tags it. Money out of savings needs a goal that holds enough. A savings rule can carry a goal; it applies to money going in only. The goal of an existing move can be changed or cleared in the transaction's transfer section. See [Internal transfers](internal-transfers.md#move-to-savings).
- **Changing a goal's account** (or switching to by hand) is refused while it holds money ("Take the money out of this goal first"); with €0 held, its entries are dropped and the savings rules pointing at it are cleared.
- **Deleting an account** keeps its goals' money: their entries stop following the deleted rows and the goals become goals tracked by hand with the same total.
- **Monthly amount** = what's left ÷ months left, rounded up to the cent. Months left count the current month and the target month ("by June" from September = 10). A date in the current month asks for the whole remainder.
- **On track**: a straight line from the plan's start (amount and month) to the target (amount and month), read at the **start of the current month**, so this month's saving isn't due yet. Below the line = "Behind by X". BigInt cross-product.
- **Plan restart**: the start amount and date are set at creation (€0) and reset whenever target, date or account changes (not on rename or icon change), so an edit never makes past months look missed.
- **Reached** when saved ≥ target (kept with a badge until deleted). **Past target date** once the date's month is over and it isn't reached (no monthly amount shown). Without a date, only progress is shown.
- The target date can't be before today, except an unchanged date when editing.
- Safe to spend is unaffected: untick the savings account's "Count in safe to spend" instead.

## Code

- `src/lib/goals/progress.ts`, `row-progress.ts`, `input.ts`, `snapshot.ts` (Undo), `money.ts` (Not assigned, `canAssign`, `assignedPercent`), `savings-options.ts` (Move to savings choices)
- `src/db/queries/goals.ts` (`listGoalMoney`, `assignToGoal`, `moveBetweenGoals`, `goalHolds`, `deleteGoal` returns the snapshot, `restoreGoal`), `src/db/queries/savings.ts` (`moveToSavings` with a goal, `setMoveGoal`)
- `src/app/(app)/settings/goals/` (`goals-screen.tsx`, `goal-form.tsx`, `contribution-form.tsx`, `move-goal-form.tsx`), `src/app/(app)/home/goal-gauge-row.tsx`, `src/lib/goals/presets.ts` (quick amounts), `summary.ts` (the card above the list), `src/app/(app)/goals-card.tsx`, `src/app/(app)/transactions/savings-step.tsx`, `transfer-section.tsx`
- Migrations `0019_savings_goals`, `0034_goal_money` (adds `savings_goal_contributions.transaction_id` and `savings_rules.goal_id`, drops the one-goal-per-account index, and gives each existing account goal one entry equal to its account's balance on the migration day, so what it had saved is unchanged)

## Tests

`src/lib/goals/*.test.ts` (monthly amount, on track, reached, past date, Not assigned), `src/db/queries/goals.test.ts` (shared accounts, limits, restore, delete account, the migration's backfill SQL), `src/db/queries/savings.test.ts` (moves with a goal, rules, `setMoveGoal`); `e2e/goals.spec.ts` (menu sheets, delete with Undo, assign from Not assigned), `e2e/savings.spec.ts` (move to a goal and change it).

## Related

[Bank accounts and balance](accounts-and-balance.md) · `SPEC.md` §44 and §70
