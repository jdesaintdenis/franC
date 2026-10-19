# Budget page

The Budget tab (`/budget`), one page for **any month** (Slice 59, `SPEC.md` §74). It merges the old Plan page and "Ce mois-ci" (`/month`); both addresses no longer exist. Home only summarizes where the accounts stand today ([Dashboard](dashboard.md)); this page is where a month is analysed. It wears the 50 F look ([Language and theme](language-and-theme.md)); `/budget/next-month`, `/recurring`, `/year`, `/settings/budgets` and `/settings/goals` keep Tricolore.

## Layout

Phone, top to bottom: the title row (**Budget**, then ‹ **Juillet 2026 ▾** ›), the **Le mois** card, **Où est passé l'argent**, **Budgets**, **À venir** (current month only), **Objectifs**, **Solde**, **Aller plus loin**. From 1024 px two columns: month card and Où est passé l'argent on the left, Budgets and the rest on the right. Where the money went comes before the budgets (`SPEC.md` §84). The header carries the "Data up to …" caption. Everything counts **all accounts**: there is no account filter on this page (`?account=` is ignored).

Links that lead here carry the month and category: `dashboardHref` (`src/lib/dashboard/month.ts`) builds `/budget?month=…&category=…`. Needs attention's "below its alert" and "low balance ahead" rows open `/budget#balance`.

## How it works

### Month

Opens on the current calendar month in Europe/Paris. `?month=YYYY-MM` selects another; an invalid value falls back to the current month. Three ways to change month: the ‹ › arrows (plain links, they work without JavaScript; › is disabled on the current month), a tap on a bar of the month card, and a tap on the month name, which opens the month picker. An empty month shows "Aucune dépense en {month}" in the card, with the chart still there, then the empty state (links to Import and to the latest month with data); budgets and categories are hidden. Month math is pure string arithmetic (`src/lib/dashboard/month.ts`).

### Month picker

Tapping the month name opens **"Choose a month"** in a bottom sheet (a centred dialog on desktop), so a month ten months back is one gesture away:

- the year with ‹ › arrows, from the first year with data to the current year;
- a 3 × 4 grid of months, each with what was spent that month in short form ("€2.9k", "2,9 k€"); the selected month is highlighted;
- months without any transaction are greyed out and can't be chosen, and so are future months; the current month can always be chosen;
- **Back to this month** (hidden when you're on it), and the footnote "Amounts are what you spent. Months without data are greyed out."

One grouped query (`getMonthlyHistory`: spent, income and row count per month over all history, transfers excluded) feeds the picker, the bars and "latest month with data". Cells are built by `buildPickerYear` and the arrows' bounds by `pickerYearBounds` (`src/lib/dashboard/month-picker.ts`).

### The month card ("Le mois")

- **Big line**: what was spent, rounded to the euro. Spent = sum of outflows, income = sum of inflows, net = income − spent, all integer cents, all in SQL. [Internal transfers](internal-transfers.md) and [ignored](transactions.md#ignoring-a-transaction) transactions are excluded, with a line under the card counting the transfers.
- **Planned**: "sur X prévus" then what is left ("restants" on the current month, "de marge" on a past one, green) or "dépassé de X" (amber). Planned spending (`plannedSpendingCents`, `src/lib/budgets/planned.ts`) = every budget's available amount (budget + rollover, never below 0) plus the month's regular payments that no budget covers, both those already paid in the month (rows linked to a regular payment, `getRecurringCharges`) and those still projected (a bill in a budgeted category, or in a subcategory of one, is already inside that budget). Budgets keep no history, so a past month uses today's budget amounts. When some of the month's spending sits in no budget (no budgeted category or parent, uncategorized included) and is not linked to a regular payment, the line adds "dont X hors budget" (`outsideBudgetCents` in `planned.ts`, fed by `getUnlinkedSpendingByCategory` in `src/db/queries/budgets.ts`; split parts count in their own category, transfers and ignored rows excluded). It is part of the spent amount, so the reader sees why the month can be "dépassé" while no budget is over.
- **Current month**: "jour d / n" and, under it, income so far and confirmed income still due ("4 502 € attendus le 29 oct.").
- **Past month**: the change against the previous month ("−6 % vs juin", green when lower, amber when higher, hidden when the previous month has no spending), and "Revenus … · bilan …" (net signed; "Bilan" is the month net).
- **Bars** (`MonthBars`, `monthBarWindow` in `src/lib/dashboard/month-bars.ts`): nine months ending four after the selected one, never past the current month; when the window reaches the current month the **next month** is added as an outlined bar (its planned amount, recurring). The selected bar is periwinkle, the month in progress is hatched, and every bar is a link to its month. A dashed line marks the selected month's planned amount ("prévu 4 300 €"). Plain HTML, no chart library.
- **Verdict** (`budgetVerdict`, `src/lib/budgets/verdict.ts`): current month "Il reste X sur Y de budgets, pour N jours"; past month "N budgets tenus sur M · X de dépassement au total" or "Tous les budgets tenus". Hidden without budgets, and on a finished month with no spending. In French, months inside sentences are lower case (`inSentence`).

### Budgets

Every budget, as on Home: icon, name, "x sur y", a ten-block gauge and a big percentage ([Budgets](budgets.md)). Over budget is amber, never red. On the current month a white tick marks today's pace and "rythme rapide" appears for a budget ahead of it; a past month shows its final state ("dépassé de X"). A rollover **deficit** is told in words, never as a negative "sur": "{spent} dépensés · {carry} de retard reporté" (100 %), or "{spent} sur {available} · {carry} de retard reporté" when some room remains (`budgetDetail`, `src/lib/dashboard/home-lists.ts`; the same line on Home).

Budgets with regular payments (Slice 66, [Budgets](budgets.md)): the gauge pre-fills with the paid payments (sand) and the ones still due (hatched), "· X à venir" joins the detail line, and one line per payment follows ("payé le 3 oct." with a green tick, "attendu le 20 oct." with a sand ring). A budget its payments fill to at least 95 % (rent, a loan) is folded under "Voir les N budgets de prélèvements", with its total and what is still due; a past month shows paid payments only. Every budget of the current month that is not over shows "Reste X à dépenser" under its gauge.

### Où est passé l'argent

- A ring in the categories' own colours, "Dépenses" and the total in its centre, then the **top 4** categories as rows (icon, name, amount, share, a bar in the category colour scaled to the largest). **Toutes les catégories (N)** reveals the rest in place. "Non catégorisée" is amber.
- **Outflows only**, so a refund never hides spending. Uncategorized outflows form an "Uncategorized" bucket. [Split](splits.md) rows count per part. Transfers excluded.
- Rolled up to **top-level categories** in SQL.
- **Active category**: mouse hover on a slice or keyboard focus on a list row shows the **detail card** (icon, name, amount, share of the month, and each subcategory with its amount and % of the category, largest first; spending filed on the parent itself is its own row). The active slice is pulled out 6px and its row highlighted.
- **Mouse click** on a slice navigates. **Touch tap** selects it instead (never navigates); the card's **Open** link goes where a click would. Tap again, tap outside (a click, so scrolling never clears it), Escape or the close button clears it. Touch vs mouse comes from each pointer event's `pointerType`, not screen size.
- **Drill-down**: a parent with subcategory spending goes to `/budget?month=…&category=<parent>` (its subcategories plus "(no subcategory)"), keeping the scroll position (`scroll={false}` via `staysOnPage` in `category-spending.tsx`); otherwise to `/transactions?from=…&to=…&category=…&direction=out&transfers=hide`.
- **Percentages** use the largest-remainder method on integer cents, so every list adds up to exactly 100%; a non-zero share under 1% shows "<1%".
- **Accessibility**: the chart is decorative (`aria-hidden`); the list is the accessible path, each row carrying a screen-reader subcategory summary.

### À venir (current month only)

The next three payments from [Regular payments](recurring.md), with a link to Récurrents. Hidden without recurring items.

### Objectifs

Every [savings goal](savings-goals.md) in Home's row shape, then, when a Savings account exists, "Mis de côté en {mois} : {montant}" for the selected month ([Accounts](accounts-and-balance.md#account-type-current-or-savings-slice-52)). Without goals, one row invites to add one.

### Solde (every month)

The card draws the **selected month's balance**, day by day, so months can be compared (`monthBalanceCurve`, `src/lib/balance/month-curve.ts`):

- **Past month**: the real end-of-day balance, rebuilt backwards from the account's known balance and the day-by-day net of its transactions (`getDailyNet`, `src/db/queries/balance.ts`; ignored rows excluded; the operation date decides the day).
- **Current month**: real up to the last known day (solid), then dashed to the month's end: the projected recurring payments minus what the budgets still hold back, spread evenly per day (`budgetsLeftCents` of [Safe to spend](safe-to-spend.md)).
- The header shows the balance at the month's end ("Fin du mois", or "Fin prévue" on the current month), then "Début … · Point bas … le …". A threshold line shows for a single account. A month ending before the first known transaction says "Pas de solde connu pour ce mois".
- With several accounts the curve is the total. The current month also keeps its per-account rows, "includes N payments expected since your last import" and the bank/"as of" lines; the 30-day low-balance alert on Home links to `#balance`.

### Aller plus loin

Recurring payments, Next month (hint "{month}: about €X left", the Next month "What's left" figure), Year, each with its hint ([Regular payments](recurring.md), [Next month](recurring.md), [Yearly review](yearly-review.md)).

### Charts

Recharts v3 draws the ring and the balance curve, one shared look in `src/components/charts/`:

- **Colour roles** (`chart-style.ts`): the balance curve uses the theme's accent, threshold `--warning` (amber), categories their own colours (`categoryDisplayColor`). No red in any chart, and none on chart amounts.
- **Tooltip** (`ChartTooltip`): one popover-card look (day as title, the balance with cents). Mouse hover, or a tap or drag of a finger along the curve.
- Charts stay `aria-hidden` with nothing focusable inside; the sr-only summaries and the category list carry the data. No chart animation.

## Code

- `src/app/(app)/budget/`: `page.tsx`, `plan-data.ts` (`loadBudgetMonth`), `month-card.tsx`, `month-bars.tsx`, `month-title.tsx`, `transfers-note.tsx`, `loading.tsx`; `next-month/` is the Next month page (`next-month-data.ts`, `outlook-card.tsx`, `to-confirm-row.tsx`, `forecast-list.tsx`)
- Shared with Home in `src/app/(app)/`: `home/home-budgets.tsx`, `home/home-goals.tsx`, `home/home-section.tsx`; own components: `month-picker-sheet.tsx`, `category-spending.tsx`, `category-detail-card.tsx`, `balance-card.tsx`, `balance-chart.tsx`, `coming-up.tsx`
- `src/lib/budgets/planned.ts`, `charges.ts`, `verdict.ts`; `src/lib/dashboard/month.ts`, `month-bars.ts`, `month-picker.ts`, `home-lists.ts`; `src/lib/balance/month-curve.ts`; `src/db/queries/dashboard.ts`, `balance.ts`

## Tests

`e2e/budget-charges.spec.ts`, `e2e/budget-page.spec.ts` (month arrows, picker, bars, rollover wording, no red), `e2e/dashboard.spec.ts`, `e2e/home.spec.ts`, `e2e/spending-chart.spec.ts`, `e2e/chart-touch.spec.ts`, `e2e/splits.spec.ts`, `e2e/subcategories.spec.ts`, `e2e/transfers.spec.ts`, `e2e/savings.spec.ts`, `e2e/budgets.spec.ts`, `e2e/balance.spec.ts`; `planned.test.ts`, `month-bars.test.ts`, `verdict.test.ts`, `month-curve.test.ts`, `home-lists.test.ts`, `month.test.ts`, `navigation.test.ts`.

## Related

`SPEC.md` §20, §26, §29, §36, §52, §72, §74
