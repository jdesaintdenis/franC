# Yearly review

The Year page (`/year`) shows a whole year at once in the 50 F look (Slice 63, `SPEC.md` §78): how much was saved, how each month ended, where the money went and came from, and what each category cost. It fits a phone: no table, no chart that scrolls sideways.

## Using it

- Open it from **Budget > Year** (the current year). Its back arrow returns to Budget.
- **Year bar** under the title: ‹ 2026 ›, with an "in progress" chip for the current year. The arrows are links; you can't go before the first year with data or after the current year. A year with no transactions links to Import and to the latest year with data.
- There is no account filter: the page always covers every account, like the Budget page.

Sections, each a titled card, in one column (two from `lg`):

1. **Headline**: the year in one figure (saved, or overspent), a note under it, then three columns: **Income**, **Spent** and **Spent per month**. Under them the best and toughest months (below).
2. **Month by month**: twelve bars, one link per month, opening that month on the Budget page. Each bar is the month's **net** (income − spent): up from an axis when it saved, down when it cost more than it brought. Best month green, other positive months soft blue, negative months amber, the current month hatched, months without data or still to come empty. Scale: `netBarScale` puts the axis where the tallest positive and the deepest negative meet, so both fit.
3. **The months**: one row per past or current month with data, newest first: month name, "in progress" chip for the current one, "€X in · €Y spent" (plus "· +€Z set aside" with a Savings account, [Internal transfers](internal-transfers.md#move-to-savings)) and the net on the right (green when positive). Each row opens that month.
4. **Where the money went**: the Budget page's ring and ranked rows ([Budget page](budget-page.md)), for the **whole year** or **one month**. The period button beside the title opens a sheet with "Whole year" and the twelve months (`?flow=year` or `?flow=YYYY-MM`); months after today are disabled. A row opens the matching transactions.
5. **Where it came from**: income by top-level category (name, amount, share), hidden when the period has no income. A row opens the matching inflows.
6. **By category**: one row per top-level category: colour tile, name, year total, "≈ €X / month", and a 12-bar sparkline of its months (biggest months in the category colour). A **Total** row follows. A row opens the year's transactions for that category.

## How it works

### What is counted

The same figures as the dashboard, so a month here matches that month there:

- [Internal transfers](internal-transfers.md) are excluded everywhere. Moving money to your own savings account is not spending, so it shows up as "set aside" in the months list (only when a Savings account exists). The headline "Saved in {year}" still means income − spent.
- Income and spent are **whole transactions** (inflows and outflows, like the month totals); **refunds count as income**.
- Per-category figures read **category lines**: a [split](splits.md) transaction counts once per part, in the part's category. Subcategories roll up into their top-level category; Uncategorized is its own row.
- All sums are done in SQL, in integer cents (`bigint`).

### Headline

`yearHeadline(income, spent)` picks the sentence (the UI only formats it):

| Kind | When | English (label, figure, note) |
|---|---|---|
| `saved` | income > spent by at least €1 (whole-euro rounding) | label "Saved in 2025" over the figure €1,234, note "12% of your income"; the current year's label is "Saved since January" |
| `overspent` | spent exceeds income by at least €1 | label "Spent more than earned in 2025", figure €80 in amber, note "Your balance covered the difference" |
| `even` | the gap rounds to €0 | label "Spent what you earned in 2025" |
| `noIncome` | income is zero or less | label "Spent in 2025", figure €X, note "No income recorded in 2025" |

French has the same labels ("Épargné en 2025", …).

### Best and toughest months

Under the totals, each month name linking to that month on the dashboard. `bestAndWorstMonths` takes the month with the highest and the lowest saved (income − spent) among **finished months with at least one transaction**: the current month is left out, because a salary that has landed before the bills would always look best. Shown only with at least 2 such months and when best and toughest differ; ties go to the earliest month. Wording: "Best month: March, €450 saved"; "Toughest month: July, €758 more spent than earned", or "Lowest month: April, €119 saved" when even the lowest month saved money.

### Colour rule

No amount on this page is red. In the months list the net is green (`text-positive`) when positive and plain when negative (the minus sign says it), like the month net on the Budget page. Amounts that round to zero never show a minus sign ("-€0", "-0%"): `formatWholeCents`, `formatPercent` and `formatCompactCents` use `signDisplay: "negative"`.

### Savings rate

(income − spent) ÷ income, as a whole percent rounded half away from zero, computed with integer maths. It can be negative. With no income it shows "—". The year's rate uses the year's totals, not an average of the monthly rates.

### Category rows

- **Outflows only** (a refund never lowers a category), per split part, transfers excluded: each month of a sparkline equals that month's Budget ring, and the Total row equals its "Spent".
- **Monthly average** = total ÷ **months covered**, rounded to the cent (half away from zero). Months covered run from the first month with any transaction that year to December, or to the current month for the current year. A year that starts in March is not diluted by empty months. A note under the rows says how many months were used. **Spent per month** in the headline uses the same count.
- **Biggest months**: the month(s) with the highest spending are drawn in the category colour (others softer), only when the row has spending in at least 2 months. A screen-reader line says "Most spent in March". Future months are empty bars.
- Links: a row opens `/transactions` on that category and the year, outflows, transfers hidden (a parent includes its subcategories). Total opens the whole year.

### Where the money went and came from

- Same ring, rows and "See all" behaviour as the Budget page (`CategorySpending`), fed by `getSpendingByCategory` for the chosen period. The period button is the `aside` of the section title.
- Nothing in the period gives "No income or spending in this period." in that card. A year with nothing at all shows "Nothing in {year}" with Import, and **Go to {year}** for the latest year with data.
- An invalid or out-of-year `flow`, or one after today, falls back to the whole year.
- Shares of the income list come from `percentShares` (largest remainder), so they add up to exactly 100%.
- The Sankey, its tables and the monthly chart and table are gone (Slice 63): they overflowed a phone and repeated the same numbers.

## Code

- Pure logic in `src/lib/year/`:
  - `year.ts`: year param, months, `monthsCovered`
  - `averages.ts`: `monthlyAverage`, `buildCategoryMatrix`, `biggestMonths`
  - `savings-rate.ts`
  - `headline.ts`: `yearHeadline`
  - `highlights.ts`: `bestAndWorstMonths`
  - `net-bars.ts`: `netBarScale`
- Queries in `src/db/queries/year.ts`: `getCategorySpendingByMonth`, `getIncomeBySource`, `getFirstMonthWithData`, `getYearsWithData`. The page also reuses `getMonthTotals`, `getMonthlyTrend` and `getSpendingByCategory` from `dashboard.ts`, whose top-level roll-up is shared through `topCategoryColumns`.
- UI in `src/app/(app)/year/`: `page.tsx`, `loading.tsx`, `year-title.tsx`, `year-headline.tsx`, `year-net-bars.tsx`, `year-months.tsx`, `period-sheet.tsx`, `income-sources.tsx`, `category-year-rows.tsx`, `hrefs.ts`. The section cards are `HomeSection`, the ring is `src/app/(app)/category-spending.tsx`.
- `formatWholeCents`, `formatSignedWholeCents`, `formatPercent` in `src/lib/money.ts`
- Messages in `messages/{en,fr}/year.json`
- No migration.

## Tests

- Unit: `src/lib/year/*.test.ts`, covering months covered, averages and rounding, biggest months, savings rate, the headline kinds, the best/toughest months and the net bar scale.
- DB: `src/db/queries/year.test.ts`, covering splits per part, excluded transfers, user scoping, and month columns adding up to the year's spent.
- E2E: `e2e/year.spec.ts` imports a past year and checks the headline, the best and toughest links, the bar labels, the months list, the category row with its biggest month, the period sheet, axe, and no sideways scroll at 390 and 360 px. `e2e/next-month-year-50f.spec.ts` checks the period sheet disables future months and the 360 px layout. `e2e/a11y.spec.ts` runs axe on the empty `/year`.

Formatter edge cases (no "-0", en and fr) are in `src/lib/money.test.ts`.

## Related

[Budget page](budget-page.md) · [Dashboard](dashboard.md) · [Splits](splits.md) · [Internal transfers](internal-transfers.md) · `SPEC.md` §47, §78
