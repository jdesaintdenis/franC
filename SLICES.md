# franC — Slices

Work top to bottom, one slice at a time. Tick a box only when the slice's **Done when** criteria are met, `pnpm typecheck && pnpm lint && pnpm test` pass, and the feature documentation in `docs/features/` describes the new behavior (new page or updated page, listed in `docs/features/README.md`).

## Slice 0 — Setup, foundations and reproducible environment
The goal is that a fresh clone gets to a working app with **one command**, on my machine or in a Claude Code cloud session.

**Project**
- [x] Repo cloned, `.gitignore` covers `.env*`, `node_modules`, and real CSVs (`*.csv` except `docs/samples/`)
- [x] `SPEC.md`, `CLAUDE.md`, and `SLICES.md` committed to the repo root
- [x] Anonymized sample export (50–100 rows) added to `docs/samples/`
- [x] Next.js + TypeScript (strict) + Tailwind + shadcn/ui scaffolded
- [x] ESLint, `typecheck` script, Vitest, and Playwright configured
- [x] Node version pinned (`.nvmrc` and `engines` in `package.json`) and pnpm version pinned (`packageManager` field)

**Docker environment**
- [x] `docker-compose.yml` with a `db` service (PostgreSQL 16, named volume, healthcheck) and a separate `db-test` database for tests
- [x] `Dockerfile` (multi-stage: dev and production) so the same image can later be used for deployment
- [x] `app` service in Compose behind a profile (`docker compose --profile app up`) for full-Docker parity; the default flow runs Next.js on the host against the Dockerized DB
- [x] `.env.example` with a working default `DATABASE_URL` that matches Compose, plus `.dockerignore`
- [x] Idempotent `scripts/setup.sh`: check prerequisites, start the DB, wait until healthy, `pnpm install`, run migrations, seed defaults, print next steps
- [x] Fallback in `scripts/setup.sh`: if Docker isn't available, skip it and use whatever Postgres `DATABASE_URL` points to
- [x] Drizzle connected, with a first migration applied and a test proving the DB connection works
- [x] `pnpm` scripts for the environment: `db:up`, `db:down`, `db:reset`, `setup`
- [x] `.claude/settings.json` SessionStart hook that runs the setup when the session is a cloud one (`CLAUDE_CODE_REMOTE=true`), without failing the session if a step breaks
- [x] `docs/cloud-setup.md`: the setup script to paste into the Claude Code cloud environment (pre-pull Docker images so they're cached), required env vars, and network access level
- [x] `README` section "Getting started" with the local and cloud paths

**Done when:** on a fresh clone, `pnpm setup && pnpm dev` shows a page; `pnpm typecheck && pnpm lint && pnpm test` all run green; and the same works in a Claude Code cloud session.

## Slice 1 — PWA shell and deployment
- [x] Web app manifest (name, icons, theme color, standalone display)
- [x] Serwist service worker with offline app shell
- [x] Mobile-first layout with bottom or side navigation (Home, Transactions, Recurring, Import, Settings)
- [x] Deployed to the chosen EU host with a production database — code is ready (`vercel.json`, `vercel-build` script); needs your Vercel + Neon accounts, see `docs/deployment.md`
- [x] Installed on my phone from the deployed URL — manual, after deployment

**Done when:** the app installs on my phone and opens from the home screen.

## Slice 2 — Schema and authentication
- [x] Drizzle schema for users, accounts, imports, transactions, categories, category_rules, recurring
- [x] Unique constraint on `(account_id, dedupe_hash, occurrence_index)`
- [x] Initial migration generated and applied
- [x] Authentication set up (sign in / sign out), all pages protected
- [x] Default account and seed categories created for a new user
- [x] Every query scoped by `user_id`

**Done when:** I can log in, and unauthenticated access redirects to login.

## Slice 3 — CSV parsing and dedupe logic (no UI)
- [x] Parser for my bank's export format, based on the sample in `docs/samples/`
- [x] Zod validation per row, with a clear list of row errors
- [x] Label normalization function
- [x] Dedupe hash + occurrence index computation
- [x] Unit tests: valid rows, invalid rows, identical same-day transactions, re-parsing the same file

**Done when:** parsing the sample CSV yields the expected transactions, and unit tests cover the edge cases above.

## Slice 4 — Import flow (upload → preview → confirm)
- [x] Upload page with file picker and account selection
- [x] Preview step: counts (new / duplicate / error), sample of new rows, error list
- [x] Confirm step: insert new rows in a single DB transaction
- [x] `imports` record created with counts
- [x] Re-uploading the same file inserts 0 new rows
- [x] Uploading an overlapping export inserts only the new rows
- [x] Playwright test for the import flow

**Done when:** importing my real export works, and re-importing it is a no-op.

## Slice 5 — Import history and undo
- [x] Import history list (date, filename, counts)
- [x] Undo an import (removes only that import's transactions, with confirmation)

**Done when:** I can undo an import and re-import it cleanly.

## Slice 6 — Transactions list
- [x] Paginated or virtualized list, newest first
- [x] Text search on label
- [x] Filters: date range, category, amount range, uncategorized only
- [x] Usable on mobile

**Done when:** I can find any transaction quickly on my phone.

## Slice 7 — Categories and rules
- [x] Manage categories (create, rename, recolor, delete)
- [x] Assign a category manually to a transaction
- [x] Create a rule from a transaction ("always categorize like this")
- [x] Manage rules (list, edit, reorder priority, delete)
- [x] Rules applied automatically on import
- [x] Rules applied retroactively to uncategorized transactions
- [x] Manual categories never overwritten by rules
- [x] Unit tests for rule matching and priority

**Done when:** after an import, most transactions are categorized automatically.

## Slice 8 — Dashboard
- [x] Month selector
- [x] Totals for the month: spent, income, net
- [x] Spending by category chart
- [x] Month-over-month trend chart
- [x] Drill-down: tap a category to see its transactions
- [x] Aggregations done in SQL

**Done when:** the home screen answers "where did my money go this month?" in a few seconds.

## Slice 9 — Recurring payment detection
- [x] Detection algorithm (merchant grouping, interval, amount tolerance) as pure functions
- [x] Unit tests with monthly, weekly, yearly, and non-recurring fixtures
- [x] Detection runs after each import
- [x] Recurring page listing detected and confirmed items
- [x] Confirm / dismiss actions (dismissed items don't come back)
- [x] `next_expected_date` computed

**Done when:** my real subscriptions and bills show up on the Recurring page.

## Slice 10 — Next-month forecast
- [x] Forecast computation from recurring items
- [x] Expected total for next month on the Recurring page
- [x] "Coming up" widget on the dashboard
- [x] Detected (unconfirmed) items visually distinguished from confirmed ones
- [x] Unit tests for the forecast

**Done when:** I can see what to expect next month, with dates and amounts.

## Slice 11 — Polish and hardening
- [x] Empty states and helpful error messages
- [x] Loading states and optimistic UI where it helps
- [x] Accessibility pass (labels, contrast, keyboard)
- [x] Offline behavior verified (shell loads, clear message when data is unavailable)
- [x] Security review: user scoping on all queries, no financial data in logs, secrets audit
- [x] Database backups configured (the daily cron writes them to Vercel Blob), see `docs/backups.md`
- [x] Lighthouse PWA score checked — Lighthouse no longer has a PWA category; scores and the installability checks are in `docs/lighthouse.md`

**Done when:** I'm comfortable using it daily on my phone.

## Slice 12 — French and English (i18n)
- [x] i18n library chosen and wired into the App Router (proposed: `next-intl`, which supports server components; new dependency)
- [x] Every UI string moved to message files (`en`, `fr`), including auth pages, empty states, errors, toasts, and the offline page
- [x] Language resolved per request: saved preference, else the browser's `Accept-Language`, else English
- [x] Language picker in Settings, saved on the user (migration) so it follows them across devices
- [x] `<html lang>` and the web app manifest follow the active language
- [x] Dates, months, and amounts formatted with the active locale at the UI edge (`lib/money.ts`, date helpers); storage stays cents and SQL `date`
- [x] Test that fails when a message key exists in one language but not the other
- [x] Playwright test: a French browser gets the French UI, and switching to English in Settings sticks

**Done when:** the whole app reads naturally in French or English, following my browser by default and my choice once I set it.

## Slice 13 — Subcategories
- [x] `categories.parent_id` (migration), limited to two levels (category > subcategory), scoped by `user_id`
- [x] Manage subcategories in Settings: create under a parent, rename, recolor, move to another parent, delete
- [x] Deleting a parent asks what happens to its subcategories and their transactions (move up to the parent, or uncategorize)
- [x] Category pickers (transaction dialog, rules, filters) show the hierarchy, e.g. "Housing > Furniture"
- [x] Transactions filter on a parent includes its subcategories
- [x] Dashboard spending chart groups by parent, with drill-down into subcategories
- [x] Rules can target a subcategory
- [x] Bulk edit on Transactions: select several rows and set or clear their category at once (manual source, one DB transaction)
- [x] Unit tests for hierarchy validation (no cycles, max depth) and parent roll-up totals

**Done when:** I can file a purchase under "Housing > Furniture" and still see it counted in Housing on the dashboard.

## Slice 14 — Bank categories
- [x] No default categories: new users start with none (stop seeding them; update `SPEC.md`), and existing users keep theirs as regular top-level categories
- [x] Empty category pickers explain how to get categories (import a file or create one)
- [x] Parser keeps the bank's `Categorie` / `Sous categorie` columns, stored on each transaction (migration); the bank's "A categoriser" placeholders count as no category
- [x] Re-importing an old export backfills the bank categories on transactions already in the database (only those columns; still inserts 0 new rows), so past transactions can be guessed too
- [x] Import preview lists bank categories and subcategories I don't have yet, each with **Create**, **Map to an existing category**, or **Ignore**, plus **Create all**; bank subcategories are created under their category (or under the category it is mapped to); created ones are added in the confirm transaction, ignored ones are remembered and not asked again
- [x] Imported rows get the category their bank category maps to, with a new `category_source` value `bank` (migration); only rows rules left uncategorized, and rules replace a `bank` category, never the reverse
- [x] Bank category mappings (bank category/subcategory → my category) stored per user and editable in Settings
- [x] Unit tests: placeholder handling, backfill on re-import, new vs mapped vs ignored bank categories, create all, rule precedence
- [x] Playwright test: an import with a new bank category offers Create / Map / Ignore, and creating it categorizes the matching rows

**Done when:** my first import builds my categories from the bank's, and later imports only add categories I said yes to.

## Slice 15 — Multiple accounts
- [x] Manage bank accounts in Settings: create, rename, delete (with confirmation; deleting removes its imports and transactions)
- [x] Import page picks the account, remembering the last one used
- [x] Transactions list shows the account and can filter by it (`account` URL param)
- [x] Dashboard and forecast cover all accounts, with an optional account filter
- [x] Recurring detection stays per account
- [x] Every account query scoped by `user_id`; tests that another user's account can't be used for import or filtering

**Done when:** I can import my second bank account's export and see both accounts together or separately.

## Slice 16 — Internal transfers
- [x] Detect transfers between my own accounts: opposite amounts on two different accounts within a few days, as pure functions
- [x] Detected pairs linked (migration) and marked as internal transfers; I can confirm, unlink, or mark one by hand
- [x] Internal transfers excluded from spent, income, and net on the dashboard, and from the category chart (replaces the Slice 8 decision that transfers count; update `SPEC.md`)
- [x] Deleting an account or undoing an import unlinks its transfer pairs
- [x] Transactions list shows them marked, with a filter to hide them
- [x] Detection runs after each import
- [x] Unit tests: matching pairs, same-day and delayed transfers, amounts that match by coincidence on the same account, already-linked rows

**Done when:** moving money between my accounts no longer inflates my spending and income.

## Slice 17 — Budgets per category
- [x] Monthly budget target per category or parent category (migration), in integer cents
- [x] Manage budgets in Settings; a budget on a parent covers its subcategories, and subcategory budgets are shown inside it (never added on top)
- [x] Dashboard shows spent vs budget for the selected month, with over-budget categories highlighted
- [x] Budget progress computed in SQL
- [x] Unit tests for roll-up and over/under computation

**Done when:** I can see at a glance which categories are over budget this month.

## Slice 18 — Split transactions
- [x] Split one transaction into parts with their own category and amount (separate table, migration); parts must sum to the transaction amount
- [x] The original row is untouched, so dedupe and re-import keep working
- [x] Dashboard, budgets, and category filters count the parts instead of the whole
- [x] Split dialog on Transactions: add, edit, remove parts, with the remainder shown
- [x] Rules, bank category mappings, and bulk edit never touch a split transaction (nor guesses, if optional category guessing is built), and it never shows as uncategorized
- [x] A split transaction can't be an internal transfer, and vice versa
- [x] Unit tests: sum validation, aggregation with splits, undoing an import removes its splits

**Done when:** I can split a supermarket receipt between groceries and household and see each in the right category.

## Slice 19 — Recurring price alerts
- [x] Detect when a recurring payment charges more than its usual amount (beyond the existing tolerance), as pure functions
- [x] Alert shown on the Recurring page and the dashboard, with old and new amounts
- [x] I can acknowledge an alert (accept the new price as usual) or dismiss it
- [x] Checked after each import
- [x] Unit tests: price increase, small variation within tolerance, one-off spike

**Done when:** I notice a subscription price increase the month it happens.

## Slice 20 — Export
- [x] Export transactions as CSV (with the current filters), including category, subcategory, and account
- [x] A split transaction is written as one line per part (Slice 18)
- [x] Export categories, rules, and budgets
- [x] Amounts exported from cents without float conversion; dates as `YYYY-MM-DD`
- [x] Download generated server-side, scoped by `user_id`, and never logged
- [x] Unit tests for the CSV output (escaping, amounts, dates)

**Done when:** I can get all my data out in a file I can open in a spreadsheet.

## Slice 21 — Dark mode
- [x] Light, dark, and system themes; system (follows the phone or computer setting) is the default
- [x] Theme picker in Settings, saved on the user (migration) like the language, and remembered in a cookie so pages render in the right theme on first paint (no light flash)
- [x] Every page, dialog, toast, and chart readable in dark mode: charts and category colors use theme tokens or colors with enough contrast on both backgrounds
- [x] Browser `theme-color` and the web app manifest follow the active theme where the platform allows it
- [x] Offline page and auth pages follow the system theme
- [x] Unit test for theme resolution (saved choice, else cookie, else system)
- [x] Playwright test: a browser set to dark gets the dark UI, and choosing Light in Settings sticks

**Done when:** the app looks right at night on my phone, following my system setting unless I pick a theme.

## Slice 22 — Category icons
- [x] Each category and subcategory can have an emoji as its icon, stored in the existing `categories.icon` column (validated with Zod as a single emoji)
- [x] Emoji picker in Settings when creating or editing a category (searchable, works on a phone), with a way to clear the icon; the icon picker is lazy-loaded so it doesn't slow down other pages
- [x] Icons shown next to the category name wherever it appears: category pickers, transaction rows, filters, dashboard list, budgets, recurring items, and the import preview
- [x] A subcategory without an icon shows its parent's; a category without one shows its color dot as today
- [x] Categories created from bank categories (Slice 14) start without an icon
- [x] Export (Slice 20) includes the icon column
- [x] Unit tests for icon validation and parent fallback

**Done when:** I can recognize my categories at a glance by their emoji, like Notion pages.

## Slice 23 — Better spending chart
Builds on Slice 22 (category icons).

- [x] Selecting a slice shows a detail card: the category's icon, name, amount, and share of the month, plus each subcategory with its amount and its percentage of the category
- [x] Each slice shows its category's icon on the chart (inside the slice, or just outside for small slices; hidden when a slice is too small to fit it)
- [x] On desktop, hovering shows the detail card and clicking a slice opens the category, as today
- [x] On touch screens, tapping a slice selects it and shows the detail card instead of navigating; the card has an "Open" link to the category's transactions, and tapping elsewhere clears the selection
- [x] Selected slice highlighted (e.g. pulled out slightly); the list below the chart highlights the same category
- [x] Keyboard and screen reader users get the same details from the list, with subcategory percentages
- [x] Percentages computed with integer math from cents; display-only rounding
- [x] Unit tests for the subcategory percentages (rounding, zero totals, a category with no subcategories)
- [x] Playwright test on a phone viewport: tapping a slice shows its details without leaving the page, and "Open" goes to the category

**Done when:** on my phone I can tap a slice to see what's inside it without landing on another page by mistake.

## Slice 24 — Account balance and 30-day projection
Inspired by Linxo and Bankin' (projected balance, overdraft warning).

- [x] Each account has a starting balance and the date it applies from, entered once in Settings > Accounts (migration, integer cents), since the bank export has no balance column
- [x] Current balance = starting balance + every transaction on or after that date, computed in SQL; transfers between my accounts move money but don't change the total
- [x] Projected balance for the next 30 days from confirmed (and, marked as such, detected) recurring items, day by day
- [x] Dashboard shows today's balance and the lowest projected balance with its date, per account and for all accounts
- [x] Warning when the projection goes below zero (or below a threshold I set), naming the day and the payment that causes it
- [x] Unit tests: balance from a start date, projection with weekly/monthly/yearly items, overdraft day detection

**Done when:** I can see whether I'll be short before payday without opening my bank app.

## Slice 25 — Merchant names
Inspired by Actual Budget's payee rules and Lunch Money's payee renaming.

- [x] Rename a merchant once (e.g. "PRLV ORANGE BOX" → "Orange"); the name applies to every matching transaction, past and future (migration)
- [x] Matching reuses the rule matcher on normalized labels (contains / starts with / exact), as pure functions
- [x] The display name is used in the transaction list, search, recurring items, the dashboard, and export; the raw label stays visible in the transaction details and is never modified (dedupe unaffected)
- [x] Recurring detection groups by display name when one is set, so renamed variants of one merchant form one item
- [x] Manage merchant names in Settings, and "Rename merchant" from a transaction row
- [x] Unit tests: matching, precedence when two names match, recurring grouping, search on both names

**Done when:** my lists read "Orange, Netflix, Carrefour" instead of bank gibberish.

## Slice 26 — Review new transactions
Inspired by Copilot's review queue.

- [x] Transactions from an import start as "to review" (migration); older transactions are marked reviewed
- [x] Review page lists them newest first, grouped by import, with category, split, transfer and rename actions inline
- [x] Mark one, a selection, or all as reviewed; changing a category marks it reviewed
- [x] Dashboard and navigation show how many transactions are waiting for review
- [x] Works well on a phone: one row at a time, big tap targets, keyboard shortcuts on desktop
- [x] Unit tests: import marks rows to review, undo import removes them from the queue
- [x] Playwright test: import, review, the counter goes to zero

**Done when:** after each import I go through the new rows in a couple of minutes and know nothing slipped by.

## Slice 27 — Category guessing
Previously the optional section. Builds on Slice 26 (the review page). Guesses never touch a split transaction.

- [x] Guessing as pure functions in `src/lib/categorize/`, with no external service (transaction data never leaves the app)
- [x] Guess from my own past categorizations of similar labels, for rows the bank categories (Slice 14) left uncategorized
- [x] Each guess has a confidence; below a threshold, no guess is made
- [x] New `category_source` value `guess` (migration); guesses only fill rows that rules left uncategorized
- [x] Rules always win: running rules replaces a guess, and a guess never replaces a rule, bank, or manual category
- [x] Runs automatically on import, after rules and bank categories, in the same DB transaction
- [x] "Guess categories" action on the review page, for uncategorized transactions, also re-applying bank category mappings
- [x] Guessed and bank categories are visually marked, and I can accept (becomes manual), change, or clear them; "Always categorize like this" works from a guess
- [x] When I correct guesses or categorize similar labels by hand to the same category a few times, suggest creating a rule (as in Copilot and Actual Budget)
- [x] Unit tests: label similarity, confidence threshold, rule suggestion, rule precedence, manual categories untouched

**Done when:** after an import, most transactions that no rule catches get a sensible guess I can confirm in a few taps.

## Slice 28 — Safe to spend
Inspired by PocketGuard's "In My Pocket". Builds on Slice 24 (balance) and Slice 17 (budgets).

- [x] "Safe to spend until the end of the month" = current balance − recurring payments still due this month − what's left in each budget, as pure functions in integer cents
- [x] Expected recurring income before month end is included only when confirmed
- [x] Shown at the top of the dashboard with a breakdown (balance, bills still due, budgets left) on tap
- [x] Shows a clear negative state instead of hiding it
- [x] Unit tests: mid-month, bills already paid, over-budget categories, no budgets set

**Done when:** one number tells me how much I can still spend this month without breaking anything.

## Slice 29 — Budget rollover and presets
Inspired by Lunch Money and YNAB.

- [x] Optional rollover per budget (migration): unspent money carries into next month, overspending reduces it
- [x] Rolled-over amount shown next to the month's budget on the dashboard and in Settings > Budgets
- [x] One-click presets when setting a budget: same as last month, or the average of the last 3 months' spending
- [x] Pace warning: a category on track to go over by the end of the month is flagged before it actually does
- [x] Unit tests: rollover across months, negative carry, presets, pace computation

**Done when:** irregular expenses like gifts or car repairs can build up a budget over several months.

## Slice 30 — Savings goals
Inspired by YNAB targets, Monarch goals, and Firefly III piggy banks.

- [x] A goal has a name, target amount, optional target date, and optional icon (migration, integer cents)
- [x] Progress comes from a chosen savings account's balance (Slice 24) or from money I assign to it manually
- [x] With a date, shows how much to put aside per month to get there, and whether I'm on track
- [x] Goals listed on a Goals section of the dashboard and managed in Settings
- [x] Unit tests: monthly amount needed, on-track status, goal reached, past target date

**Done when:** I can see how far I am from "Car: €3,000 by June" and what I need to save each month.

## Slice 31 — Subscription overview
Inspired by Rocket Money. Builds on Slice 19 (price alerts).

- [x] Recurring page shows the yearly cost of each item and the total I spend on subscriptions per year
- [x] A confirmed item not charged for two expected cycles is flagged "Cancelled?", and I can mark it ended (it leaves the forecast)
- [x] Filter recurring items by category and sort by yearly cost
- [x] Unit tests: yearly cost for weekly/monthly/yearly items, missed-cycle detection
- [x] Feature docs: `docs/features/recurring.md` updated

**Done when:** I know what my subscriptions cost per year and notice the ones I've already cancelled.

## Slice 32 — Tags and notes
Inspired by Monarch and Lunch Money.

- [x] Free-text note on a transaction (migration), editable from the transaction row and searchable
- [x] Tags on transactions that cut across categories (e.g. "Holidays 2026"), many per transaction; tags are per user
- [x] Filter by tag on Transactions, with the total for the filtered set; bulk-add a tag to a selection
- [x] Tags and notes included in export (Slice 20); notes are never logged
- [x] Unit tests: tag validation, filtering, export columns
- [x] Feature docs: `docs/features/transactions.md` and `docs/features/export.md` updated (or a new tags page)

**Done when:** I can see what a trip cost me in total, across groceries, restaurants, and transport.

## Slice 33 — Yearly review and income flow
Inspired by Monarch and Lunch Money reports.

- [x] Year page: spending per category by month in a table, with yearly total and monthly average, and the biggest months highlighted
- [x] Income vs spending per month for the year, with the savings rate
- [x] Sankey chart for a month or a year: income flowing into categories and savings, with an accessible table equivalent
- [x] Aggregations done in SQL, respecting splits and excluding internal transfers
- [x] Unit tests: yearly averages, savings rate, Sankey data shape
- [x] Feature docs: new `docs/features/yearly-review.md` page, listed in the index

**Done when:** at the end of the year I can see where my money went and how much I saved.

## Slice 34 — Import reminder
Specific to franC, since there is no bank sync.

- [x] Dashboard banner when the latest transaction of an account is older than a number of days I choose (default 14), with a link to Import
- [x] Optional PWA push notification for the same reminder, off by default
- [x] Dashboard and forecast say which date the data runs until
- [x] Unit test for the staleness check per account
- [x] Feature docs: new `docs/features/import-reminder.md` page (or `csv-import.md` updated), listed in the index

**Done when:** I never look at stale numbers without knowing it.

## UX redesign (Slices 35–44)
From a UX/UI review done on 2026-09-30 by running the app with a year of realistic data on a phone and a computer, in light, dark and French. The review found that every screen shows everything at the same weight, so nothing stands out, and that the app looks like a grey template. Decisions are in SPEC §49. Mockups of the target screens (today vs proposed, light and dark): https://claude.ai/artifact/TR8Jv1VdByJoofSEec9gSd. Slices 35 and 36 come first; 38–42 can then follow in any order.

## Slice 35 — Design foundations (Tricolore)
How things look, not where they are.

- [x] Tricolore colour tokens in `globals.css` (`light-dark()`): French blue brand for buttons, links and selection, navy for the hero card, flag red only for the logo's "C" and the flag stripe; semantic `positive` (money in), `warning` and `destructive` tokens replace the ad-hoc `emerald-*` / `amber-*` / `red-*` classes
- [x] "fran**C**" wordmark (blue with a red C) on login, signup and Home; app icon updated
- [x] Figtree font, self-hosted (no CSP change); tabular figures on amounts
- [x] Category palette of distinct colours that avoid the brand blue and money red/green; "Create all" gives each top-level category its own colour and each subcategory a shade of its parent; the add form proposes the next unused colour
- [x] Default emojis for the bank's top-level categories on "Create all" (subcategories still none, §37); a migration recolours categories still on an old automatic colour and adds the emoji to known bank category names
- [x] Friendly dates in lists and cards: "Today", "Yesterday", "Mon 28 Sept", year only when not the current one (string-based, no `Date` shifting)
- [x] Headline amounts without cents (safe to spend, month totals, year cards); lists keep cents
- [x] i18n fixes: "Uncategorized" and the default account name translated, "day(s)" as an ICU plural
- [x] Unit tests: date helpers (today, yesterday, year boundary, both locales), palette distinctness and contrast, subcategory shades, bank emoji map, recolour selection, headline formatter
- [x] Feature docs: `language-and-theme.md` (tokens, font, colour rule), `categories.md`, date format in `transactions.md` and `dashboard.md`

**Done when:** franC looks like its own app in both themes, categories are easy to tell apart, and dates read like a person would say them.

## Slice 36 — Navigation and page structure

- [x] Bottom bar: Home · Transactions · a raised central **＋ Import** button · Plan · More
- [x] **Plan** gathers Budgets, Goals, Regular payments, next month's forecast and the Year review; **More** gathers Accounts, Categories, Rules, Merchants, Tags, Bank categories, Export and the preferences (Settings keeps working as a route)
- [x] From 1024 px: a left sidebar with the same entries, and pages may use two columns
- [x] One page header component (title, optional back arrow, optional action) used by every page
- [x] "Go deeper" links become full-width tappable rows or card footers with a chevron
- [x] Playwright: every entry reachable from the bar and the sidebar; a11y spec updated
- [x] Feature docs: navigation described in `docs/features/README.md` and the pages that moved

**Done when:** what I look at often is one tap away and Import is under my thumb.

## Slice 37 — Home redesign

- [x] Hero card: safe to spend for the rest of the month, a per-day figure, a thin month-progress bar, and "How is this worked out?" opening the breakdown in a bottom sheet; near the month's end it also shows next month's starting point
- [x] "Needs attention" list right below, most urgent first (stale import, to review, over or ahead of budget, price increases, low balance ahead), hidden when empty
- [x] Month section with the switcher at its top; tapping the month name opens a **month picker** (year arrows, 12-month grid with what was spent, months without data greyed out, "Back to this month")
- [x] Month totals, top budgets with a pace marker, spending by category (donut with the total in the centre, top categories, "See all")
- [x] Balance card with axis values, a labelled alert line and the lowest point marked; compact Coming up (3 rows) and Goals
- [x] Desktop: two columns
- [x] Unit tests: attention list ordering, per-day figure, month-picker availability; Playwright: pick a month, open "How is this worked out?"
- [x] Feature docs: `dashboard.md`, `safe-to-spend.md`

**Done when:** opening the app tells me in one glance how much I can spend and whether anything needs me.

## Slice 38 — Transactions list

- [x] Grouped by day with sticky day headers ("Today", "Yesterday", "Mon 28 Sept") and the day's total
- [x] Rows: category emoji (top-level) or the merchant's initial in the category colour, merchant name in normal case (bank labels title-cased when no merchant name), category below, amount on the right
- [x] Live search (no Apply button); filters as chips under the search bar with a bottom sheet for the full set; locale-correct date fields
- [x] Swipe right to change category, left for more actions; Select and Export move to a "⋯" menu
- [x] Playwright: search, a chip filter, swipe to recategorize (and its keyboard equivalent)
- [x] Feature docs: `transactions.md`

**Done when:** scrolling my transactions feels like my bank app, only clearer.

## Slice 39 — Transaction detail sheet

- [x] On a phone the detail opens as a bottom sheet (a dialog on desktop): merchant, amount, date, account, bank label
- [x] Every field saves on its own (category, merchant name, note, tags) with a "Saved · Undo" toast; no Save / Update / Add buttons
- [x] "Always categorize like this" becomes a suggestion shown after changing the category
- [x] Split, transfer link and rename open as steps inside the sheet; the review card reuses the same components
- [x] Playwright: change category and note without a save button, undo
- [x] Feature docs: `transactions.md`, `splits.md`, `tags-and-notes.md`, `review-queue.md`

**Done when:** fixing a transaction is one tap per change, and the same everywhere.

## Slice 40 — First run and import

- [x] Welcome checklist on an empty Home: import, check categories, enter the balance, set a first budget; each step ticks itself and the list disappears when done
- [x] Import: a large "Choose your bank export" area that previews as soon as a file is chosen; summary first (new, duplicates, errors, date range), transaction list collapsed
- [x] Bank categories step: "Create all" preselected, list collapsed under "Customise"
- [x] After a first or large import, one button "Guess categories, then mark all as reviewed", with "Review one by one" as the alternative
- [x] Android / installed PWA: franC as a share target for CSV files
- [x] Playwright: a new user goes from empty to a useful Home through the checklist
- [x] Feature docs: `csv-import.md`, `review-queue.md`, `pwa-offline.md`

**Done when:** a new user gets from an empty app to a useful Home without wondering what to do next.

## Slice 41 — Regular payments

- [x] Headline "€X a month" in bills and subscriptions, with "Confirm all" when some were found automatically
- [x] Compact rows (icon, name, amount, frequency, next date); tap opens a sheet with history, confirm / dismiss and price alerts; swipe to confirm or dismiss
- [x] Sections: Bills and subscriptions, Income, Dismissed (collapsed); the forecast moves to Plan
- [x] Playwright: confirm all, dismiss one, undo
- [x] Feature docs: `recurring.md`

**Done when:** I see what my fixed costs are in one screen, without scrolling past buttons.

## Slice 42 — Lists you manage

- [x] Budgets shows only budgeted categories, plus "Add a budget" suggesting categories by spending with the 3-month average prefilled; editing opens a sheet with amount, roll-over and "Use average"
- [x] Categories, Rules, Tags, Merchants, Goals and Accounts: list first, "＋ Add" in the header opening a sheet, one "⋯" menu per row, names never truncated
- [x] Deletes offer Undo instead of a confirmation where the data model allows it
- [x] Playwright: add and edit a budget, category actions through the "⋯" menu
- [x] Feature docs: `budgets.md`, `categories.md`, `categorization.md`, `tags-and-notes.md`, `merchant-names.md`, `savings-goals.md`, `accounts-and-balance.md`

**Done when:** each list shows my things first and every action is one menu away.

## Slice 43 — Feedback, motion and empty states

- [x] One shared toast (above the bottom bar) for "Saved", "Deleted · Undo" and errors
- [x] Optimistic updates on category changes and confirmations
- [x] Short transitions for sheets, list changes and progress bars, off with "reduce motion"
- [x] A friendly empty state with one clear action on every list, in the style of "All caught up"
- [x] Loading skeletons matching the new layouts
- [x] Feature docs: the affected pages

**Done when:** every tap visibly does something, and nothing feels frozen or empty.

## Slice 44 — Charts and Year polish

- [x] Year: "You saved €X" / "You spent €X more than you earned", no "-0 %", best and worst months named
- [x] Charts share one style: brand colours, axis labels, tap to see values on touch, totals in donut centres, accessible tables kept
- [x] Feature docs: `yearly-review.md`, `dashboard.md`

**Done when:** the charts read at a glance and the year page tells me something in words.

## Automatic bank sync (Slices 45–49)
From a deep dive on 2026-10-02 into the Caisse d'Épargne (BPCE) API, aggregators, and how YNAB, Actual Budget, Lunch Money, Monarch, Bankin' and Linxo handle automatic import. Decisions are in SPEC §60. Sync goes through **Enable Banking**'s free mode for your own linked accounts; CSV import stays for older history and gaps. Work them in order.

## Slice 45 — Connect your bank

- [x] Enable Banking client in `src/lib/bank-sync/`: JWT signed with `node:crypto` (no new dependency), responses validated with Zod, injectable `fetch` for tests; `ENABLE_BANKING_APP_ID` and `ENABLE_BANKING_PRIVATE_KEY` in `.env.example` and `docs/deployment.md`; the feature is hidden when they are unset
- [x] Confirm the Enable Banking sign-up steps and whether the redirect URL may be `localhost`; write them in `docs/deployment.md`
- [x] Tables `bank_connections` (user, bank, session, valid until, status) and `bank_account_links` (franC account ↔ bank account id); migration
- [x] More > **Bank connection**: choose your Caisse d'Épargne, log in on the bank's page, come back to franC, then link each bank account to an existing franC account or create one; Disconnect keeps all data
- [x] Unit tests against a fake Enable Banking server; Playwright for connect, link and disconnect with the fake
- [x] Feature docs: new `bank-sync.md`

**Done when:** I can connect my Caisse d'Épargne once and see which franC account each bank account feeds.

## Slice 46 — Sync now

- [x] One real sync of my account compared with my CSV (dates, labels, ids, short labels); findings in SPEC, only an anonymized fixture committed
- [x] **Sync now** per connection (and on Import for a connected account): booked transactions only, converted to the same shape as CSV rows and sent through the same pipeline (merchant names, rules, guesses, review queue, transfers, recurring); sync runs appear in import history
- [x] `source` (csv / sync) and `external_id` on transactions; repeated or placeholder ids treated as missing; date fallback transaction → booking → value date
- [x] Start date chosen at connect: right after my newest transaction for that account (90 days at most)
- [x] Short label for synced rows (bank prefixes and suffixes such as CB, PRLV, VIR, FACT ddmmyy stripped), or the matched CSV row's short label, so rules and merchant names keep matching
- [x] Feature docs: `bank-sync.md`, `csv-import.md`

**Done when:** one tap brings my new bank transactions into franC, categorized and waiting in Review.

## Slice 47 — Manual and automatic together

- [x] Matcher in `src/lib/bank-sync/` (pure), both directions: same `external_id` → same transaction; else same account, same amount, dates within ±3 days → one candidate is merged automatically (the existing row keeps its category, note, tags and splits)
- [x] Several candidates → the row is marked **Possible duplicate** in Review with **Same transaction** (merge) or **Keep both** (remembered)
- [x] CSV preview on a connected account counts rows the sync already brought in as duplicates; Import says "This account syncs automatically. Import a CSV for older history or a gap."
- [x] **Ignore** a transaction (hidden from totals, kept so it doesn't come back); sync runs have no Undo
- [x] The transaction sheet says "From your bank" or "From CSV, 12 Sept"
- [x] Playwright: overlap between a CSV import and a sync, a possible duplicate merged and one kept
- [x] Feature docs: `bank-sync.md`, `csv-import.md`, `review-queue.md`, `transactions.md`

**Done when:** I can import a CSV and sync the same account without ever counting a purchase twice.

## Slice 48 — Balance from the bank

- [x] Balance checkpoints ("the balance was X at the end of day D"): migration turning the starting balance into the first checkpoint; each sync adds the bank's booked balance
- [x] On a connected account the balance is the bank's and read-only ("From Caisse d'Épargne, 2 Oct 07:00"); unconnected accounts work as today; disconnecting keeps the last bank balance as a manual one
- [x] Consistency check: when franC's transactions don't add up to the bank's change between two checkpoints, "Needs attention" says how much is missing and between which dates, with **Import a CSV for those dates** or **Accept the bank's balance** (a note on the checkpoint, not a transaction)
- [x] Projection, Safe to spend and Goals use the bank's figure without changes of their own
- [x] Feature docs: `accounts-and-balance.md`, `bank-sync.md`

**Done when:** a connected account always shows my bank's balance, and franC tells me when its own data has a gap.

## Slice 49 — Daily sync and connection health

- [x] The daily cron (07:00 UTC) also syncs every healthy connection; failures retried on the next run; logs hold counts only
- [x] Status per connection: **Synced 2 h ago** / **Reconnect needed** / **Sync failed**
- [x] **Reconnect** reuses the connect flow and keeps the account links; offered from 14 days before the 180-day consent ends
- [x] Home "Needs attention": "Reconnect your bank (expires 28 Mar)" and "Sync failing since …"; the import reminder only watches accounts that aren't connected
- [x] Push notification (generic text, as today) for "reconnect needed" and "sync failing" only
- [x] **Bank rate limit shown clearly**: a 429 from Enable Banking (`ASPSP_RATE_LIMIT_EXCEEDED`) gets its own error code instead of `bank_unavailable`: "Your bank's limit for today is reached. franC will try again tomorrow morning." (Sync now and the connection status alike); the cron leaves that connection until its next run and doesn't count it as "sync failing". No "syncs left" counter: Sync now sends the PSU headers, so it isn't counted against the bank's 4 unattended fetches a day (SPEC §60)
- [x] **Import button only while it's needed**: the raised Import button (bottom bar) and the sidebar's Import button show only while at least one account has no bank link. When every account is connected, the bar is four equal tabs (Home · Transactions · Plan · More)
- [x] Without the button: Home shows the sync status with **Sync now** ("Synced at 07:00 · Sync now"); pull to sync was dropped (SPEC §65): franC syncs when it opens and Home's Sync now covers the rest; **Import a CSV** is a row in More and on the Bank connection page ("for older history or a gap"), and the Slice 48 gap card keeps its CSV link. The review badge stays on Transactions; the CSV share target keeps working
- [x] Users without bank sync, or with a manual account, keep today's Import button, drop zone, welcome checklist and import reminder
- [x] Playwright: the bar with and without a manual account; Import a CSV from More
- [x] Feature docs: `bank-sync.md`, `import-reminder.md`, `navigation.md`, `csv-import.md`

**Done when:** my transactions arrive every morning without me doing anything, franC tells me before the connection lapses, and the Import button no longer takes room I don't need.

## Feedback round (Slices 50–54)
From feedback on the app on 2026-10-05 (12 items, checked against the code in `/mnt/project-files/plans/feedback-slices.md`). Decisions are in SPEC §66. Quick bug fixes first, then by value / effort. Real data is in production: no slice may lose existing categories, assignments, rules, synced rows or regular payments.

## Slice 50 — Home and mobile fixes

Three bugs found on a phone, plus a default account for Home.

- [x] **Donut selection survives scrolling**: `useChartSelection` clears on any `pointerdown` outside the chart, and a finger starting a scroll is one. Clear on a tap outside (a click), Escape or a second tap only. Fixes the Home donut, the trend bars and the Year income flow at once (same hook)
- [x] **No jump to the top when opening a category on Home**: the rows under the donut are links to `/?category=<parent>`, a navigation that resets the scroll. Opening a category's subcategories keeps the scroll position (no full reload feel); Back returns to the same place
- [x] **Sheets stay above the phone keyboard**: fixed once in `components/ui/sheet.tsx` (follow `visualViewport` so a bottom sheet sits above the keyboard and the focused field scrolls into view). Checked on every sheet with a text field: category, merchant, rule, budget, goal, note, account, tags, bank connection
- [x] **Default Home account**: More > Accounts gets "Set as default" in each account's ⋯ menu (Remove as default on the current one), stored on `users.home_account_id` (nullable, `on delete set null`). Home without `?account=` opens on it; the account chip still switches to All accounts. Migration only adds the nullable column
- [x] Playwright on a phone viewport: select a slice, scroll, the card stays; open a category, the scroll position is kept; a field in a sheet is visible with a resized viewport; the default account applies and All accounts still works
- [x] Feature docs: `dashboard.md`, `accounts-and-balance.md`, `feedback-and-motion.md`

**Done when:** I can tap a category on my phone, scroll to read its detail, and type in any sheet without the keyboard hiding it.

## Slice 51 — Easier categories

- [x] **Hex colour**: a text field next to the colour swatch (`#1e3a8a`, Zod-validated, kept in sync with the swatch), for phones whose native picker has no hex input
- [x] **Colours you've used**: each row in More > Categories shows its colour clearly (a tinted leading area, readable in dark mode), and the colour field marks a colour already taken ("Used by Groceries")
- [x] **＋ on each top-level category** adds a subcategory under it (the existing form with the parent set). The ⋯ menu item stays
- [x] **Subcategory emojis** (reverses SPEC §37): a subcategory shows its own emoji when it has one, else its colour dot; no fallback to the parent's emoji. The icon picker shows for subcategories. On the subcategory donut (Home drill-down) a subcategory slice shows its colour **and** its emoji, like top-level categories. Stored icons were kept, so no migration and nothing to restore
- [x] Unit tests for hex validation and subcategory icons (`categoryIcon` removed: it only returned the stored icon; covered by hierarchy and query tests); Playwright: set a hex colour, add a subcategory with ＋, give it an emoji, see it in the list and on the drill-down
- [x] Feature docs: `categories.md`, `dashboard.md`

**Done when:** I can pick an exact colour, see which ones are taken, and add a subcategory with its own emoji in two taps.

## Slice 52 — Savings

Transfers to savings count as saved, not spent or earned. Savings accounts take no import or sync (SPEC §67).

- [x] **Account type**: Current (default) or Savings, switched in the account sheet; account creation unchanged. A Savings account takes no CSV import and no bank link; "Count in safe to spend" goes off
- [x] **Move to savings** on an outflow (detail sheet): pick a Savings account; franC creates the matching inflow there and links the two as a confirmed internal transfer. Undo removes the created row. The created row is marked as created by franC and never deduplicated against imports
- [x] **Automatic moves**: "Also move past and future payments like this" stores a rule on the label, moves the earlier matching rows at once and later ones after imports and syncs
- [x] Moving money back (an inflow from savings) works the same way
- [x] **Saved** on Home next to Spent and Income (only with a Savings account); Year table: old Saved renamed Net, new Saved column
- [x] Recurring detection keeps the Current-account leg of a transfer to savings
- [x] Migration `0032_savings` adds enum values, defaulted columns and a table only
- [x] DB tests (`savings.test.ts`), unit tests for rules and Saved, Playwright `e2e/savings.spec.ts`
- [x] Feature docs: `accounts-and-balance.md`, `internal-transfers.md`, `dashboard.md`, `yearly-review.md`, `recurring.md`, `categorization.md`, `csv-import.md`, `bank-sync.md`, `safe-to-spend.md`

## Slice 53 — Variable regular payments

A salary that changes a little every month is never detected: detection needs each amount within ±10% of the last.

- [x] **Track as regular payment** in the transaction detail sheet: creates a **confirmed** item that follows every payment with the same label key (or merchant), whatever the amount; cadence from the history, monthly by default
- [x] Its expected amount is the **median of the last 6** payments, shown "about €2,850"; the item sheet shows the range of the last 6
- [x] Coming up, Next month, the balance projection and Safe to spend (expected income) use the expected amount
- [x] Detection never deletes or reshapes a tracked item; it refreshes its dates and links when new payments arrive. **Stop tracking** turns it back into an ordinary item (removed, or left to detection)
- [x] Migration adds `recurring_items.source` (`detected` | `manual`, default `detected`): existing items keep their status, alerts and links
- [x] Unit tests for the median and grouping; Playwright: track a varying salary, see "about" on Regular payments and in Next month
- [x] Feature docs: `recurring.md`, `safe-to-spend.md`

**Done when:** my salary shows in Next month with roughly what I'll get, even though it changes every month.

## Slice 54 — Create a category while categorizing

Today a missing category means leaving the transaction, creating it in More > Categories, then coming back. Moved after Slices 50–53 on 2026-10-05.

- [x] In the category picker (`category-picker-list.tsx`, used by the transaction sheet, Review and the list's swipe; the bulk edit selects get a **New category…** option instead), when the search matches no category exactly: a **Create "Courses"** row at the end of the list, also offered from the empty state ("No category matches")
- [x] Tapping it opens a short form in place (the picker's next step, no page change): name prefilled from the search, top-level or under a parent (default: top level; pre-selects the parent when the search matched only its subcategories), optional emoji (the lazy-loaded picker from Slice 22) and colour (next free colour by default)
- [x] **Create and use**: creates the category through the same query and Zod validation as Settings (`createCategory`, duplicate names refused per parent with the same message), then applies it to the transaction like a pick (same toast with Undo, marks it reviewed, rule suggestion as today); Undo restores the previous category and keeps the new category
- [x] Back returns to the list with the search kept; nothing is created until the button is pressed
- [x] The new category shows at once in every open picker and filter (no reload); a failed save shows the error toast with **Try again**, like other picks
- [x] Works on a phone (keyboard opens on the name, tap targets ≥ 44 px) and in bulk edit (the created category applies to the selection)
- [x] Unit tests for the "no exact match" rule (accents and case ignored) and the default parent; DB test that the action is scoped by `user_id`; Playwright: search a missing name in the sheet, Create and use, the row shows the new category, it is listed in More > Categories
- [x] Feature docs: `categories.md`, `categorization.md`, `transactions.md`, `review-queue.md`

**Done when:** I can categorize a transaction into a category that doesn't exist yet without leaving the transaction.

## Slice 55 — Money assigned to goals

YNAB-style goals: several goals share one account, each holds the money assigned to it.

- [x] A goal holds the sum of its entries; several goals can use one account; the rest of the balance shows as **Not assigned**
- [x] Migration keeps every goal's saved amount (existing account goals get one entry = today's balance)
- [x] **Assign money**, **Unassign money** and **Move to another goal** in the goal's menu, with limits
- [x] **Move to savings** offers the account's goals; the moved row is that goal's money; savings rules can carry a goal
- [x] Change a move's goal in the transaction sheet; Undo keeps the goal
- [x] Account sheet lists its goals and Not assigned; deleting an account keeps the goals' money
- [x] Unit + DB tests (including the migration backfill); Playwright: move to a goal, assign from Not assigned
- [x] Feature docs: `savings-goals.md`, `internal-transfers.md`, `accounts-and-balance.md`

**Done when:** I can split my Livret A between "Car" and "Holiday" and send each monthly transfer to one of them.

## Slice 56 — Add transactions by hand

Cash and the Swile meal card never reach the bank sync, so that spending is missing (SPEC §71).

- [x] **Add a transaction** (＋ on Transactions): expense or income, amount, label, date, Current account, optional category. Savings accounts are unchanged
- [x] On an account a bank link or CSV imports feed, the row **waits for the bank**: the next sync or import with the same amount within ±3 days takes it over (bank date and label, your category, note, tags and splits kept). On an account never fed (Swile, Cash) rows are final. No new account setting or type
- [x] **Not found in your bank**: a waiting row more than 7 days old shows in Review and in Home's Needs attention, with Keep, Delete or Same as… (link to a bank row)
- [x] **Edit** and **Delete** (with Undo) on rows added by hand; Ignore is not offered on them
- [x] The import reminder and the gap check ignore rows added by hand that the bank hasn't booked
- [x] Migration `0035_manual_transactions` adds an enum value and a defaulted column only
- [x] Unit tests for the form and the matcher; DB tests for adoption, Not found and scoping; Playwright: Swile flow, adoption by CSV, Not found
- [x] Feature docs: `transactions.md`, `bank-sync.md`, `csv-import.md`, `review-queue.md`, `dashboard.md`, `import-reminder.md`, `accounts-and-balance.md`

**Done when:** I can type a lunch paid with Swile, and a cheque I just wrote is matched with my bank on the next sync instead of counted twice.

## Slice 57 — Home in the 50 F look

Home becomes a short summary of the accounts today, in the 50 F Saint-Exupéry look (SPEC §72).

- [x] **This month** (`/month`, first row of Plan) takes Home's month views unchanged; month links and the default account follow
- [x] Home rebuilt in five sections: Reste à vivre (amount, francs line, per-day, pace chart), À traiter (3 rows, See all), Comptes, Budgets and Objectifs with ten-block gauges
- [x] 50 F tokens in one class (`.theme-50f`), forced dark, on Home and its nav; Manrope, Cinzel and Cormorant Garamond self-hosted; red never used
- [x] Unit tests (francs, pace series, home lists, daily spending query); Playwright updated for the move
- [x] Feature docs: `dashboard.md`, `this-month.md`, `safe-to-spend.md`, `accounts-and-balance.md`, `language-and-theme.md`, `navigation.md`

**Done when:** I open franC on my phone and read what I can spend, what is waiting, and where my budgets stand in one screen.

## Slice 58 — Opérations in the 50 F look, validating from the list

Transactions and its detail sheet move to the 50 F look and take over validation (SPEC §73).

- [x] A row needs a category (or split, confirmed transfer, ignore) to be validated; assigning a category validates it; `/review`, Mark all and bulk skip bare rows
- [x] List: day cards, amber to-review dot, ✓ per row, swipe right validates (or opens the picker), wrapping filter chips, "N to review" filter row, bulk bar over the tab bar
- [x] Detail sheet: large amount with francs, suggestion pills, "+ New" category, "Validate in X", Ignore and Delete in their own card
- [x] 50 F theme on `/transactions`, `/review`, their sheets, the bars and error toasts (amber, never red)
- [x] Unit tests (validation, review queries, filters, suggestions, day cards); Playwright `validate-in-list.spec.ts` and updated review specs
- [x] Feature docs: `transactions.md`, `review-queue.md`, `navigation.md`, `language-and-theme.md`

**Done when:** I categorize or validate a morning's transactions from the list with one hand, and nothing can be marked done without a category.

## Slice 59 — One Budget page for any month, in the 50 F look

Budget and Ce mois-ci become one page at `/budget`, for any month, in the 50 F look (SPEC §74).

- [x] `/budget` merges Budget and Ce mois-ci, any month; `/plan` and `/month` removed without redirect
- [x] Month card (spent against planned, monthly bars with the planned line, verdict) and the month picker on the month name
- [x] Budgets in Home's ten-block rows (no red, rollover wording), categories ring and bars, À venir, Objectifs, Solde with the month's balance curve, Aller plus loin
- [x] Unit tests (planned spending, bar window, verdict, budget detail, month balance curve, navigation) and E2E updates, new `budget-page.spec.ts`
- [x] Feature docs: `budget-page.md` (was `this-month.md`), `navigation.md`, `budgets.md`, `savings-goals.md`, `language-and-theme.md`

**Done when:** I open any month from the Budget tab, one tap on the month name takes me ten months back, and the page reads at a glance without red.

## Slice 60 — Lists you manage in the 50 F look

Categories, Budgets, Goals and Regular payments in the 50 F look, with the Budget page's rows (SPEC §75).

- [x] The four pages and their sheets join the 50 F scope (no red, always dark); bottom "＋" buttons replace the header ones
- [x] Categories: one card per category, no "0 €", budget pill, 12 swatches plus exact colour (hex and picker), parent as pills
- [x] Budgets and Goals in Home's ten-block rows; ＋ on each goal, quick amounts, goal source as "by hand" or "on an account", delete from the edit sheet
- [x] Regular payments: "À confirmer" block (one card at a time or a ✓/✕ list), confirmed lists, one sort and filter sheet, old/new price in the caption
- [x] Unit tests (navigation, regular totals, to-confirm queue, contribution presets, goals summary), E2E updates and new `lists-50f.spec.ts`
- [x] Feature docs: `categories.md`, `budgets.md`, `savings-goals.md`, `recurring.md`, `navigation.md`, `language-and-theme.md`

**Done when:** I confirm a morning's detected payments with one thumb, add money to a goal in two taps, and none of these pages shows red or a light theme.

## Slice 61 — Five-tab bar, Accounts tab, short Plus

One bar for every account, Accounts as a tab, Plus down to its essentials, one dark theme (SPEC §76).

- [x] Accounts at `/accounts`, Bank connection at `/accounts/bank`, no redirects
- [x] Five tabs, no Import button, sand C in the wordmark
- [x] Theme picker removed, the app always dark
- [x] Plus: Sorting, Your data, Preferences (language sheet), franC account
- [x] Accounts tab: total, accounts, bank sync, imports with the reminder switch
- [x] 50 F tokens on the remaining pages; Home loses the accounts card
- [x] Unit tests, E2E updates and new `accounts-tab.spec.ts`, feature docs

**Done when:** on my phone the bar shows the same five tabs whatever the account; Accounts shows what is on my accounts and lets me sync or import in one tap; Plus fits on one screen; no page turns white when my phone is in light mode; Home no longer has the accounts card.

## Slice 62 — Import, Bank and first run in the 50 F look

The last pages in the old structure get the 50 F look, and a new franC account is offered the bank first (SPEC §77).

- [x] Import preview shows money in, out and net; bank categories as pills with a sheet; 4-row operations sample
- [x] Result screen with one "Validate all" block (no clipped button), Undo this import
- [x] Import history with a ⋯ menu per import
- [x] Bank page: Link your bank card, one start date per bank, sheet to choose the account, Save and sync, connected card with balances
- [x] First run: bank step first for bank-sync users, gauge, order bank, balance, review, budget
- [x] Unit tests (`cashFlows`, `sharedSyncFrom`, welcome steps), E2E updates and new `import-bank-50f.spec.ts`, feature docs

**Done when:** on my phone the import preview tells me how much comes in and goes out before I import, linking my bank asks one date, and a new franC account offers the bank first.

## Slice 63 — Next month and Year in the 50 F look

The last two Tricolore pages get the 50 F look and a layout that fits a phone (SPEC §78).

- [x] Next month: "What's left" after budgets and regular payments, one to-confirm row, budgets, expected payments and income
- [x] Budget page hint shows what is left
- [x] Year: headline, month-by-month net bars, months list, ring with period sheet, income sources, category rows; no sideways scroll
- [x] Every page 50 F: bars, toasts, loading skeletons, not-found and error pages
- [x] Unit tests (`nextMonthOutlook`, `netBarScale`), E2E updates and new `next-month-year-50f.spec.ts`, feature docs

**Done when:** on my phone, Next month tells me what will really be left once payments and budgets are counted, and the year fits the screen with no sideways scroll.

## Slice 64 — Lists leftovers

The three items deferred from Slice 60 (SPEC §79).

- [x] Goals: one card per account behind goals, with its balance, assigned / left to assign and a gauge
- [x] Regular payments: confirmed lists fold to 4 rows with "Show N more"
- [x] E2E test: over budget reads amber, never red
- [x] Unit tests (`assignedPercent`, `foldedCount`), `goals.spec.ts` follows the card, feature docs

**Done when:** on Goals I see my account balance and what is left to assign; Regular payments starts with 4 rows; a test proves over budget is amber.

## Slice 65 — Coming up this month on Home

What is still due this month, under Budgets on Home (SPEC §80).

- [x] Card with the total, a month strip (dot per day, size by amount, 100 € or more in sand) and the 3 biggest bills still due
- [x] Tap a dot: a bubble names the bills of that day and the days around it
- [x] Unit tests (`buildUpcomingBills`, `dotSize`, `billsNear`), `home-upcoming.spec.ts`, feature docs

**Done when:** on my phone, under Budgets, I see at a glance whether a big payment is still to come this month, and which.

## Slice 66 — Regular payments inside budgets

A budget shows its regular payments, paid or still due (SPEC §81).

- [x] Gauge: paid payments, other spending, payments due (hatched); pace tick on the rest; "à venir" in the detail line; "Reste X à dépenser"
- [x] Budget page: one line per payment, payments-only budgets folded; Home leaves them out; Budgets settings shows all
- [x] Budget sheet: "Prélèvements" pill and note; unit tests (`charges.test.ts`, `home-lists.test.ts`), `budget-charges.spec.ts`, feature docs

**Done when:** on my phone, a budget with a subscription shows it paid or due in its gauge and what is left to spend, and rent-only budgets stay out of the way.

## Slice 67 — Loans

Follow a loan next to the accounts, tracking only (SPEC §82).

- [x] Tables `loans`, `loan_checkpoints`, `loan_payment_splits` (migration 0036); nothing written to `transactions`
- [x] Maths: monthly interest and insurance, ledger from the linked bank payments, deferral, corrections, projection, early-repayment simulation (unit tests with synthetic data)
- [x] Accounts > Crédits section, loan sheet, loan page (payments, curve, cost), split and capital corrections, delete with Undo
- [x] Repayment line in the transaction sheet; `loans.spec.ts`, feature docs

**Done when:** on my phone, a loan shows what is left to repay and how each payment splits, I can fix a split or the capital when the bank differs, and budgets and Reste à vivre are unchanged.

## Slice 68 — Loan history before today

A loan can start in the past: subscription date and capital start date, history before the synced payments (SPEC §83).

- [x] Columns `started_on`, `amortization_from` (migration 0037); form fields and validation (last payment may follow the subscription date)
- [x] Maths: real payments replayed backwards, exact deferral, one estimated period (unit tests on a forward-generated loan)
- [x] Loan page: months in all / paid / left, contract end date, "Deferral" and "Estimated period" rows, cost lines, curve from start to end with a today line
- [x] `loans.spec.ts`, feature docs

**Done when:** a loan taken years ago shows its true capital history, what is exact and what is estimated, and when it ends.

## Slice 74 — CSV column mapping

Any bank's CSV imports through a Columns step; the fixed Caisse d'Épargne parser is removed (SPEC §86).

- [x] Golden test of the old parser's output, kept as the regression guard
- [x] Table reader, mapping schema and guesses, mapped parser, date and amount formats, UTF-8 / Windows-1252 decoding
- [x] `accounts.csv_mapping` + `csv_mapping_saved_at` (migration 0039), remembered per account, latest on any account as fallback
- [x] Columns step in `/import` (en + fr), "Change" from the preview
- [x] Unit tests, `csv-mapping.spec.ts`, existing specs through the new step, feature docs

**Done when:** a CSV from a bank franC has never seen imports after matching columns once, the next file from that bank needs one tap, and the sample export still imports to the same rows.

## Slice 75 — Live on last month's income

Reste à vivre keeps income received this month for next month; a regular income on the 1st–7th counts at once; a Plus setting turns it off (SPEC §87). Replaced by a per-payment switch in Slice 76.

- [x] `getReceivedIncome` query + tests
- [x] Held income, leeway and the new formula in `buildSafeToSpend` + tests
- [x] `users.income_month` (migration 0040), More > Preferences > Income row and sheet
- [x] Breakdown sheet redesign (summary card + split bar, foldable receipt, 50 F theme; en + fr)
- [x] Feature docs, SPEC §87, E2E

**Done when:** with the salary paid on the 28th, Reste à vivre on any day of the month no longer includes it, and a salary paid on the 2nd counts for its month.

## Slice 76 — Keep one regular payment for next month

The "kept for next month" rule of Slice 75 applies to the regular incomes the user switches on, instead of to all income; the Plus setting goes (SPEC §87 D7).

- [x] `recurring.keeps_for_next_month` (migration 0041), `setKeepsForNextMonth` query + action + tests
- [x] `buildSafeToSpend` takes the switched payments; `getReceivedIncome` filters on them
- [x] "Keep for next month" switch in the regular payment sheet (en + fr); Plus "Income" row removed
- [x] Feature docs, SPEC §87 D7, E2E

**Done when:** with only the salary switched on, a salary paid on the 28th is left out of Reste à vivre, and every other income counts at once.

## Slice 79 — Expense paid with next month's money

An expense paid with the salary kept for next month comes out of what is kept, not out of this month's Reste à vivre (SPEC §87 D8).

- [x] `transactions.paid_from_next_month` (migration 0042), `setPaidFromNextMonth`, `getPaidFromNextMonth`, `hasKeptIncome` + tests
- [x] `buildSafeToSpend` adds switched expenses back (budget reserve counted once); the pace chart leaves them out
- [x] "Paid with {month}'s money" switch in the transaction sheet; "Already spent" line in the breakdown (en + fr)
- [x] Feature docs, SPEC §87 D8, E2E

**Done when:** with the salary kept and 1 800 € of fees switched on, Reste à vivre is 1 800 € higher than without the switch, and the fees still show in October's budgets.

## Later / ideas (not v1)
- [ ] Daily "N new transactions to review" notification
