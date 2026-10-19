# Navigation

franC has five places: Home, Transactions, Plan, Accounts and More. The bar is the same for every account: no raised button, no setting that hides a tab.

## Using it

- **On a phone or tablet (below 1024 px)**: a bottom bar with **Home**, **Transactions** (with the review badge), **Plan** ("Budget" in French), **Accounts** ("Comptes") and **More** ("Plus").
- **On a computer (from 1024 px)**: the bar is replaced by a left sidebar with the franC wordmark (the C in sand) and the same five entries. Plan and More use two columns; the other pages keep a single readable column.
- **Plan** (`/budget`, the Budget page, [Budget page](budget-page.md)) is one page for any month, over all accounts, in the 50 F look: the month card with its month bars, **Budgets**, where the money went, **Coming up**, **Goals**, the **Balance** curve and, under **More**, **Regular payments** ("€X a month · N to confirm"), **Next month** ("October: +€1,323.00 expected", opening `/budget/next-month`) and **Year in review**. `/plan` and `/month` no longer exist.
- **Accounts** (`/accounts`, [Accounts and balance](accounts-and-balance.md)) in the 50 F look: a total card ("On your accounts", current and savings apart), **Your accounts** (balance and a caption per account, tap to open it), **Bank sync** (one card per bank connection with its status, "valid until" and **Sync now**; **Manage** opens `/accounts/bank`; a **Connect your bank** row when none) and **Imports** (**Import a CSV**, an amber line per account overdue for an import, the import-reminder switch). **Add account** is a button at the bottom. `/import` and `/accounts/bank` belong to this tab and go back to it.
- **More** (`/settings`) is short: **Sorting** (Categories, Rules, Merchant names, Tags, Bank categories, each with a small count), **Your data** (Export), **Preferences** (Language, in a sheet) and **franC account** (the email and **Sign out**). No theme choice: the app is always dark.
- **Every page has the same header**: the title, a back arrow on pages below Plan or More, and at most one action on the right (Regular payments' **Detect now** icon). The back arrow goes to Plan from Budgets, Goals, Regular payments, Next month and Year; to Accounts from Bank connection and Import; to More from its pages; to Transactions from Review.
- **The phone's Back closes an open sheet or dialog** (the account sheet, the month picker, a confirmation…) instead of leaving the page. With two open (a confirmation over a sheet), Back closes the top one. Closing a sheet any other way (✕, swipe, tap outside, Escape, Save) leaves no extra Back step behind.
- Links that open a fuller view are full-width rows or card footers with a chevron, not small underlined words. Links inside a sentence stay plain links.

## How it works

- One table in `src/lib/navigation.ts` drives the bar, the sidebar and the highlighted entry, so they can't disagree. `activeSection(pathname)` maps a path to its section:
  - `/` → Home; `/transactions` and `/review` → Transactions; `/accounts` (and `/accounts/bank`) and `/import` → Accounts;
  - `/budget` (including `/budget/next-month`; [Budget page](budget-page.md)), `/settings/budgets`, `/settings/goals`, `/recurring`, `/year` → Plan;
  - any other `/settings…` → More. Matching is on whole path segments (`/yearly` is not `/year`).
- Home (`/`) takes no search params (Slice 57): `?month=` and `?category=` belong to `/budget`. While on Home, Transactions, the review screen, the Budget page, Categories, Budgets, Goals or Regular payments (and their sub-paths) the bottom bar and sidebar wear the 50 F look (`theme-50f`, `isFiftyFrancsPath`, which also covers single pages: `/budget` but not `/budget/next-month`; and the families `/settings/categories`, `/settings/budgets`, `/settings/goals`, `/recurring`).
- Budgets and Goals stay under `/settings/…` and belong to Plan; More is the `/settings` page. Slice 61 moved Accounts to `/accounts` and Bank connection to `/accounts/bank` with no redirect (SPEC §76): the old `/settings/accounts` and `/settings/bank-connection` answer 404.
- The 50 F look covers every page except `/budget/next-month` and `/year` (`isFiftyFrancsPath`).
- Back closes sheets (`src/components/ui/back-closes.ts`, used by the `Sheet`, `Dialog` and `AlertDialog` roots): each open layer pushes one history entry at the same URL. A `popstate` while a layer is open closes the top layer and is kept from Next.js (same page, nothing to restore); the listener is added in `src/instrumentation-client.ts`, before hydration, because Chrome runs popstate listeners in the order they were added. A layer closed another way drops its entry with one `history.go(-n)`, then puts back the URL the close left (a `?edit=` removed by `useSheetParam`). It drops nothing when a link in the sheet already navigated past its entry (Navigation API key, else history length); if that navigation lands while our Back is in flight, it steps forward again.
- The current entry has `aria-current="page"`, a brand-blue label and an indicator bar, so it isn't shown by colour alone.
- The page keeps the bar's height (plus the phone's safe area) free at the bottom; the transactions bulk bar sits just above it, and at the bottom of the screen on a computer.
- The Budget page reuses Home's budget pace and the recurring page's forecast and yearly cost; the monthly figure is the yearly cost of running outflows (confirmed and detected) divided by 12, rounded down, the same number as the Regular payments headline.

## Code

- `src/lib/navigation.ts` — sections, `TAB_SECTIONS`, `activeSection`, `isFiftyFrancsPath`
- `src/db/queries/manage-counts.ts` — the counts on the More rows
- `src/components/bottom-nav.tsx`, `src/components/app-sidebar.tsx`, `src/components/nav-items.ts` — the bar, the sidebar, shared icons and badge
- `src/components/page-header.tsx` — the page header
- `src/components/ui/back-closes.ts` — Back closes the top sheet or dialog
- `src/components/row-link.tsx` — `RowLink` and `CardFooterLink`
- `src/app/(app)/layout.tsx` — sidebar + content + bar; mounts sync on open
- `src/app/(app)/budget/` — the Budget page (`plan-data.ts` loads it) and `next-month/`
- `src/app/(app)/settings/page.tsx` — the More page
- Messages: `common.nav`, `plan`, `settings.sections`

## Tests

- Unit: `src/lib/navigation.test.ts` (sections, active tab, 50 F scope)
- E2E: `e2e/navigation.spec.ts` (phone bar, Plan and More rows, back arrows, desktop sidebar); `e2e/bank-daily-sync.spec.ts` (the same five tabs connected or not); `e2e/back-closes-sheets.spec.ts` (Back closes the account sheet and the month picker; ✕ leaves no extra Back step); `e2e/accounts-tab.spec.ts` (Accounts tab, More without accounts, old addresses gone); `e2e/a11y.spec.ts` covers `/plan` and a desktop-width pass

## Related

- [Budgets](budgets.md), [Savings goals](savings-goals.md), [Recurring payments and forecast](recurring.md), [Yearly review](yearly-review.md), [Review queue](review-queue.md)
- SPEC §49 (redesign decisions), §51 (Slice 36 decisions)
