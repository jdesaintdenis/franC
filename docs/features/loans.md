# Loans

Follow a loan (mortgage, smoothed loan, consumer loan) next to your accounts: what is left to repay, how each monthly payment splits into capital, interest and insurance, when it ends, and what it costs. Loans are **tracking only**: they never change your transactions, budgets, Reste à vivre, imports or exports.

## Using it

- **Accounts > Crédits** (`/accounts`): the total "Left to repay", then one row per loan: icon, name, "1.5% · until October 2031" (or "lower payments until …" during a deferral), the capital still owed as a negative amount, "12% repaid" and a sand ten-block gauge. Tap a row for the loan page. **Add** (or **Track a loan** when there is none) opens the sheet.
- **The loan sheet**: name, amount borrowed, **capital still owed** and the date it is owed **as of** (the figure on your bank's table), yearly rate, insurance (€ per month, or a % a year of the capital owed), last payment date, **current payment until** (only when the payment changes later, such as 4 years of interest only), and **Paid by**: the confirmed regular payment that carries the monthly debit. A loan with no payment linked still shows its schedule; its payments are counted once one is linked.
- **History before today** (optional, Slice 68): two more dates in the sheet, right after the amount borrowed. **Subscription date** is the day the loan was paid out; **Capital repayment starts** is the first payment that repays capital (the "first amortization payment" of your table; leave it empty when there was no deferral). Bank sync only holds about 90 days, so these two dates are how franC fills in the years before them.
- **The loan page** (`/accounts/loans/<id>`): a hero with the capital left, "x% repaid of y", the next payment and the end month; with a subscription date, "123 months in all · 68 paid · 55 left" and "Last payment on 5 May 2031" (without one, only "55 months left" and the last payment date); **Payments** (newest first, six then **See all**): date, capital · interest · insurance, an amber "€5.00 less than the month before" when the bank took at least 1 € more or less than last time, a ✓ when you set the split yourself; the **capital owed curve** (from the subscription, or the first figure, to the last payment, with a dotted line for today and year labels spaced so none overlap or repeat; the deferral is a flat solid line, the estimated period one dashed segment, real payments solid, the plan dashed; the vertical scale goes up to the amount borrowed); **What the loan costs** (interest and insurance paid, with "of which deferral" and "of which estimated ≈" lines when they apply, to come, total, prefixed ≈ when it includes an estimate); buttons **Correct the capital owed**, **Simulate an early repayment**, **Edit loan**, **Delete loan**.
- **Correcting a payment's split**: tap a payment, type the interest and insurance the bank shows; capital is the rest and updates as you type. **Reset to franC's calculation** removes your figures.
- **Correcting the capital owed**: "the bank says I owe X as of this day". It becomes a **Correction** line in the payments; **Remove** deletes it. Payments before a correction keep their own history.
- **Early repayment** is a simulation in the browser: "repay 5,000 € today" shows the new end month, the time saved and the interest saved. Nothing is saved.
- A bank row that pays a loan shows **Repayment · name**, its split and **See the loan** in its transaction sheet.
- Deleting a loan asks first and offers **Undo**; the bank's transactions are never touched.

## How it works

- **History** (only with a subscription date; none without one, as before Slice 68). Three parts before the first checkpoint ("capital still owed as of"), newest to oldest:
  1. **Real payments** from the bank rows before it, replayed **backwards** from the capital owed: for each payment, the capital before it is the amount that, after that payment's interest, insurance and capital, leaves exactly what was owed after it (same monthly charging rule, your corrected splits win). Exact given the rate and insurance; they never depend on an estimate (`backfillPayments`).
  2. **One estimated period** from the capital start (or the first payment after the subscription) to the month before the oldest real payment, as a single row with totals, never month by month. The capital repaid is exact (amount borrowed − capital owed before the oldest real payment). Interest and insurance are estimated by replaying one constant payment, chosen so the replay lands on that capital (integer bisection, at most 40 steps and 600 months); a smoothed loan's first phase inside this period is approximated by the same payment (`estimatePeriod`).
  3. **The deferral**, from the subscription to the month before the capital start: the capital stays the amount borrowed, so each month's interest and insurance are exact and shown as one row (`deferralEntry`). Assumes a partial deferral (interest paid every month); interest added to the capital is not covered.
  When real payments reach back into the deferral and the capital before them differs from the amount borrowed, a visible **Correction** line shows the difference instead of an estimate. The capital owed today and everything after it never change because of the history.
- **Length**: payment days are the day of the last payment, clamped in short months; total = months after the subscription date up to the last payment, paid = those up to today.
- **The last payment date** must follow the subscription date when there is one, so it can be the same day as, or before, "as of", but only when nothing is owed then (a loan already repaid); with capital still owed it must come after "as of". The field reads "Last payment of the contract" with a help line, since it is the end of the loan, not the latest debit. A loan whose last payment is already past while capital is still owed shows an amber line in its hero with a link to fix it. Without a subscription date it must be after "as of", as before. The capital start must lie after the subscription and on or before the last payment, and needs a subscription date.

- **Own tables, nothing in `transactions`**: `loans`, `loan_checkpoints` (the capital owed as of a date; the first is the loan's start, later ones are corrections) and `loan_payment_splits` (your interest and insurance for one payment). The ledger is **computed on read** from the bank rows linked to the loan's regular payment (`transactions.recurring_id = loans.recurring_id`, outflows, not ignored, dated on or after the first checkpoint).
- **Interest** each month = capital owed × yearly rate ÷ 12, rounded half-up to the cent. It is charged once per calendar month, on the first payment of that month; a second payment the same month is all capital (an extra repayment). **Insurance** is a fixed amount a month or a yearly rate on the capital owed. **Capital** = amount paid − interest − insurance; it can be negative when a payment doesn't cover the interest, and the capital owed never goes below 0.
- **Why the split is computed**: the bank takes one total a month. franC splits it with the standard fixed-rate formula, which matches the bank's amortization table within a cent per line; your corrections are the safety net, and a corrected split replaces the computed interest and insurance of that payment.
- **Rates** are stored as thousandths of a percent (1.5% = 1500), money in integer cents.
- **Percent repaid** = floor((borrowed − owed) ÷ borrowed), 0–100.
- **Next payment**: the regular payment's next expected date when it is today or later, else the last payment + 1 month, else the start date.
- **Projection**: from the next payment to the last payment date, month by month. Until **current payment until** the latest payment taken stays (a deferral or the first phase of a smoothed loan); after it, a constant annuity pays off the capital by the last date. A rate-based insurance is part of the annuity so the total stays constant like in the bank's table. The last month settles what is left; at most 600 months.
- **Limits**: name 1–50 characters, unique per user ignoring case; rate ≤ 30%; insurance ≤ 5% a year or 100,000 € a month; the "as of" date can be at most tomorrow; the last payment is after it; the paying regular payment must be a confirmed outflow of the same user.
- Deleting the paying regular payment unlinks it from the loan (the loan stays); deleting a loan removes its corrections and splits.
- Every query is scoped by `user_id`.

## Code

- `src/lib/loans/` (`calc.ts` interest and insurance, `history.ts` backward payments / deferral / estimated period, `months.ts` payment days and length, `ledger.ts`, `projection.ts` with early-repayment simulation, `progress.ts`, `next-due.ts`, `view.ts`, `input.ts` Zod schemas, `format.ts`)
- `src/db/queries/loans.ts`; migrations `0036_loans` and `0037_loan_history` (`started_on`, `amortization_from`); tables in `src/db/schema.ts`
- `src/app/(app)/accounts/loans/` (`actions.ts`, `loans-section.tsx`, `loan-form.tsx`, `loan-sheets.tsx`, `loan-screen.tsx`, `loan-curve.tsx`, `loan-row.ts`, `[id]/page.tsx`), `src/app/(app)/transactions/loan-line.tsx` and `getLoanPaymentInfo`
- Messages: `settings.loans`, `transactions.sheet.loan`

## Tests

`src/lib/loans/*.test.ts` (interest, insurance, ledger, deferral, corrections, projection, early repayment, progress, next due, form validation, view; synthetic figures only), `src/db/queries/loans.test.ts` (create/read, nothing written to transactions, scoping, corrections, splits, delete and restore), `src/lib/loans/history.test.ts` and `months.test.ts` (a forward-generated loan, replayed backwards to the cent), `e2e/loans.spec.ts` (create from seeded payments, split correction, delete, bank rows unchanged; subscription date with deferral and estimated rows).

## Related

[Bank accounts and balance](accounts-and-balance.md) · [Recurring payments](recurring.md) · `SPEC.md` §82, §83
