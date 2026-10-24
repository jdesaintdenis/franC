# Compare two months

Any two months side by side (Slice 78, `SPEC.md` §89): how much more or less was spent, income and the month's net, what changed in each category, and how much of each budget each month used. It answers "did we spend more than in July, and on what?" in one screen.

## Using it

- On the [Budget page](budget-page.md), the month card ends with **Compare with another month** ("Comparer avec un autre mois") when the month has spending. It opens `/budget/compare?a=<that month>`, set against the month before.
- `/budget/compare?a=YYYY-MM&b=YYYY-MM`, in the 50 F look, under the Budget tab. The back arrow returns to month A on the Budget page.
- **Month row**: pill A (filled), the ⇄ button that swaps A and B (a plain link), pill B (tinted). Each pill opens the month picker in compare mode (below).
- **At a glance** ("En bref"): the answer first ("**€438** less spent than in July (−15%)", green when less, amber when more, "Same spending as in July" when equal), then a table of Spending, Income and Net with A, B and the difference.
- **By category** ("Par catégorie"), legend "■ Sept ■ Jul" on the right of the title: one row per top-level category spent in either month (Uncategorized in amber, as on the Budget page): icon, name, difference, % change, then two bars on one scale (A strong, B faded) with their amounts. Biggest change first. A row opens month A's transactions for that category.
- **Budgets**: one row per budget, "**99%** vs 107%", the share of the budget spent each month (A in amber over 100%). Hidden without budgets.
- Both months without any transaction: an empty state ("No spending in September or July") instead of the cards; the pills stay to pick other months.

## How it works

### Figures

- The Budget page's own queries, once per month, over all accounts (`loadCompare`, `src/app/(app)/budget/compare/compare-data.ts`): `getMonthTotals` (spent, income, net), `getSpendingByCategory` (outflows only, split parts in their own category, subcategories rolled up to the top-level category, an uncategorized bucket) and `getBudgetProgress`. [Internal transfers](internal-transfers.md) and ignored rows are excluded. A month here matches that month on the Budget page.
- Difference = A − B in integer cents; % change = (A − B) ÷ B (`changeRatio`), hidden when nothing changed, and replaced by "new" when B is zero.
- Colours (`changeTone`): spending less is green, more is amber; for income and net, more is green. Equal shows "=". Never red.
- Budgets: spent ÷ the budget's **current base amount** (no rollover carry), whole percent half up (`budgetSharePercent`). Budgets keep no history, as on the Budget page. A subcategory budget is labelled "Parent › Name".
- A month still in progress is compared as it stands, not prorated; a note says so ("October is in progress: figures up to today.").

### Months

- `parseCompareParams` (`src/lib/compare/months.ts`) never throws: a missing or invalid `a` is the current month; `b` defaults to the month before `a`; months after the current one become the current month; `a` and `b` equal makes `b` the month before. The page renders the normalised months, without redirecting.
- Names (`monthNames`): within one year, "July" in sentences and "Jul" in headers and the legend; across years the year is added ("July 2025", "Jul 2025").
- Categories are merged by id (`compareCategories`): a category spent in one month only counts €0 in the other; name, colour and icon come from month A. Sort: biggest absolute difference, then most spent in A, then name (Uncategorized last).

### Month picker in compare mode

`MonthPickerSheet` (`src/app/(app)/month-picker-sheet.tsx`) takes an optional `compare` prop (`{ a, b, side }`):

- The trigger is the pill ("Sept 2026 ▾", accessible name "Change month September 2026").
- Title "Compare September with…", description "Pick the month to set against September."
- Cells link to `/budget/compare` with that side replaced (`compareHref`). The other side's month is shown with a dashed outline and "already picked", and cannot be chosen.
- Pill B's sheet ends with "Compare with the month before (August)" when that month can be picked and is not already B; pill A's has no footer link.

## Code

- `src/lib/compare/months.ts`: `parseCompareParams`, `compareHref`, `compareCategories`, `changeRatio`, `changeTone`, `budgetSharePercent`, `monthNames`.
- `src/app/(app)/budget/compare/`: `page.tsx`, `compare-data.ts`, `compare-pills.tsx`, `compare-sections.tsx` (summary table, legend, category rows, budgets), `loading.tsx`.
- `src/app/(app)/month-picker-sheet.tsx` (compare mode), `src/app/(app)/budget/month-card.tsx` (the link).
- Messages: `plan.compare.*`, `plan.month.compareLink`, `dashboard.monthPicker.compare*`, `taken`, `previousMonth`.

## Tests

- `src/lib/compare/months.test.ts`: params (defaults, invalid values, same month, future months, year boundary, round trip), category merge and sort, change ratio and tone, budget share, month names.
- `e2e/compare-months.spec.ts`: link from the month card, the answer line, categories by change (one spent in one month only, "new"), budget shares, row link, swap, picker with the taken month, normalised params.

## Related

[Budget page](budget-page.md) · [Yearly review](yearly-review.md) (every month of a year at once) · [Budgets](budgets.md)
