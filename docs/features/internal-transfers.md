# Internal transfers

Money moved between your own accounts is paired and left out of spending and income, so it doesn't inflate either.

## Using it

- Pairs are detected automatically. Rows in a pair show a transfer marker with the other account's name.
- In the [detail sheet](transactions.md), the **Internal transfer** row ("Linked to Savings", "Possible transfer") opens a step: see the counterpart, **Confirm** a detected pair, **Unlink** it, or (with several accounts) **link a row by hand** to a candidate. Each action shows a toast; linking and unlinking have **Undo**, confirming doesn't (unlink instead).
- Transactions filter: `transfers=hide` or `transfers=only`.
- The dashboard shows a line under the totals counting the transfers not counted, with a link to them.

## How it works

- A transfer is **always a pair**: an outflow on one of your accounts and the matching inflow on another. Money to or from an account that isn't in franC is ordinary spending or income. There is no one-sided mark.
- **Detection** (pure, `src/lib/transfers/detect.ts`): an outflow and an inflow of **exactly** the same absolute amount, on **two different accounts**, dated **at most 4 days apart** (either order), not previously unlinked. Labels are ignored. Matching is one-to-one and greedy: smallest day gap, then earliest date, then ids. Same-account opposite amounts never pair.
- **Status**: a pair where either row has the bank subcategory "Virement interne" is stored as `confirmed`; others start `detected`. Detected pairs are already excluded, and marked "Detected" until you confirm.
- **Hand links**: candidates are opposite equal amounts on another account, up to 7 days apart, not already paired. Hand links are `confirmed` and clear an earlier rejection.
- **Unlink** stores the pair in `transfer_rejections`, so it is never suggested again.
- **When**: after every confirmed import (even with nothing inserted), after undo and after deleting an account, over all unpaired rows. So a transfer pairs whenever the second account's rows arrive. Detection never removes existing pairs.
- **Excluded from**: dashboard spent, income and net, the category chart and drill-down, the trend, budgets, recurring detection. **Not** excluded from balances (they move money between accounts, the total is unchanged).
- A transfer leg can't be split, and a split row can't be a transfer.
- Undoing an import or deleting an account removes its pairs (cascade); the other row becomes an ordinary transaction again.
- Linking, confirming or unlinking re-runs recurring detection; linking or confirming marks both legs reviewed.

### Move to savings

In the transaction sheet, **Move to savings** (an outflow) or **Take back from savings** (an inflow) is offered when a Savings account exists, the row isn't split, ignored or already linked. Pick the account: franC creates the opposite row there (same amount, date and label, `source = 'franc'`, `created_from_id` = the original) and links the pair as a **confirmed** transfer, in one DB transaction. The created rows live in one hidden import per Savings account (`imports.kind = 'franc'`, never shown in Import history). They are never deduplicated against imports.

- **Goals** (Slice 55): when the Savings account has goals, the step shows the account ("· not assigned") and one button per goal. Tapping a goal creates an entry on it equal to the created row, so the moved row is that goal's money. Money back from savings needs a goal that holds enough (otherwise its button is disabled). The transfer section shows **Goal: …** with **Change**, which picks another goal or none (`setMoveGoal`); Undo of a removed move moves the money to the same goal again.

- **Undo / Remove move** (in the transfer section) deletes the created row and the pair. Unlinking a pair franC created does the same and stores no rejection.
- **Also move past and future payments like this** stores a `savings_rules` row (pattern = the merchant name, else the label key) and moves every existing matching row at once. After each import or sync, `applySavingsRules` moves the new matching rows (rows imported after the rule was created; oldest rule wins). A rule can carry the goal that was tapped: rows it moves **into** savings (past ones now, later ones after imports and syncs) are added to that goal, money taken out stays not assigned. Rules are listed on the Savings account's sheet (with their goal); removing one undoes only that rule's moves when Undo is pressed right after.
- **Saved** counts transfer pairs where exactly one leg is on a Savings account: plus the amount into savings, minus out, dated on the Current-account leg. Pairs between two Current accounts don't count.

## Code

- `src/lib/transfers/detect.ts`, `validate.ts`
- `src/db/queries/transfers.ts`, `transfer-sql.ts`
- `src/app/(app)/transactions/transfer-section.tsx`, `transfer-marker.tsx`
- Migrations `0008_internal_transfers`, `0032_savings`
- `src/db/queries/savings.ts` (`moveToSavings`, `removeSavingsMove`, `applySavingsRules`, `getSavedByMonth`), `src/lib/savings/{rules,saved}.ts` (pure), `src/app/(app)/transactions/savings-step.tsx`

## Tests

`src/lib/transfers/detect.test.ts` (pairs, same-day and delayed, same-account coincidences, already linked), `src/db/queries/transfers.test.ts`, `src/db/queries/savings.test.ts`, `src/lib/savings/*.test.ts`, `e2e/savings.spec.ts`.

## Related

[Bank accounts and balance](accounts-and-balance.md) · [Dashboard](dashboard.md) · `SPEC.md` §29
