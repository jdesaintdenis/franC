# franC — Feature documentation

One page per feature: what it does for the user, how it works under the hood, and where the code lives. These pages describe the app **as it is today**. For the reasoning behind each decision, follow the `SPEC.md §N` links; for the build order, see `SLICES.md`.

> **Keep these pages current.** Any change that adds, removes or changes a feature's behavior updates the matching page here in the same PR (or adds a new page and lists it below). See "Documentation" in `CLAUDE.md`.

## Where things are in the app

The bottom bar (a left sidebar on a computer) has **Home**, **Transactions** (and Review), **Plan** (Budgets, Goals, Recurring payments, Next month, Year), **Accounts** (balances, bank sync, imports) and **More** (Categories, Rules, Merchant names, Tags, Bank categories, Export, language, the income-month setting, sign out). See [Navigation](navigation.md).

## Getting data in

| Page | Covers |
| --- | --- |
| [Authentication](authentication.md) | Sign up allowlist, sign in/out, route protection, new-user defaults |
| [Bank accounts and balance](accounts-and-balance.md) | Accounts, starting balance, current balance, 30-day projection, low-balance warnings |
| [Loans](loans.md) | Tracking a loan: left to repay, payment split into capital/interest/insurance, corrections, projection, early-repayment simulation |
| [CSV import](csv-import.md) | Any bank's CSV, column mapping remembered per account, upload → columns → preview → confirm, dedupe, what runs after an import, history and undo |
| [Bank sync](bank-sync.md) | Connecting your bank through Enable Banking, linking bank accounts to franC accounts, disconnecting |
| [Import reminder](import-reminder.md) | Stale-data banner, "Data up to" lines, optional push notification |

## Organizing transactions

| Page | Covers |
| --- | --- |
| [Transactions list](transactions.md) | Infinite list, search, filters, filtered total, detail sheet with autosave and Undo, bulk edit |
| [Categories](categories.md) | Categories, subcategories, colors, emoji icons, deleting |
| [Categorization](categorization.md) | Rules, bank categories, guesses, precedence, rule suggestions |
| [Merchant names](merchant-names.md) | Renaming bank labels to readable merchant names |
| [Split transactions](splits.md) | One transaction, several categories |
| [Internal transfers](internal-transfers.md) | Pairing money moved between your own accounts |
| [Review queue](review-queue.md) | Going through newly imported transactions |
| [Tags and notes](tags-and-notes.md) | Notes, tags across categories, tag filter with totals, More > Tags |

## Understanding your money

| Page | Covers |
| --- | --- |
| [Dashboard](dashboard.md) | Home: Reste à vivre (francs, pace chart), Needs attention, accounts, budgets, goals, the 50 F look |
| [Budget page](budget-page.md) | `/budget`: any month in one page: month card and bars, budgets, spending ring and drill-down, coming up, goals, balance curve |
| [Budgets](budgets.md) | Monthly budgets, roll-up, rollover, presets, pace warning |
| [Recurring payments and forecast](recurring.md) | Regular payments screen (headline, rows, item sheet, swipe, Undo), detection, confirm/dismiss/restore, next-month outlook (what is left after budgets), Coming up, price alerts, yearly cost, Cancelled? and ended items |
| [Safe to spend](safe-to-spend.md) | What you can still spend until the end of the month |
| [Savings goals](savings-goals.md) | Goals, progress, monthly amount, on-track status |
| [Yearly review](yearly-review.md) | Year totals and savings rate, income vs spending per month, Sankey of where the money went, spending per category by month |
| [Export](export.md) | CSV downloads of transactions, categories, rules and budgets |

## App-wide

| Page | Covers |
| --- | --- |
| [Navigation](navigation.md) | Five-tab bar, desktop sidebar, Accounts, Plan and More pages, page header, where each page lives |
| [Feedback, motion and empty states](feedback-and-motion.md) | The shared toast (results, Undo, errors with Try again), instant changes, list and bar motion, reduce motion, empty states, loading skeletons |
| [Language and theme](language-and-theme.md) | English/French, light/dark/system |
| [PWA and offline](pwa-offline.md) | Install, service worker, offline behavior |
| [Security and privacy](security-privacy.md) | User scoping, logging rules, headers, backups |

## Operations docs (outside this folder)

- `docs/cloud-setup.md` — Claude Code cloud environment
- `docs/self-hosting.md` — install and run locally or on your own server
- `docs/deployment.md` — Vercel + Neon deployment (the production setup)
- `docs/backups.md` — encrypted nightly backups (Vercel Blob) and restore
- `docs/lighthouse.md` — Lighthouse CI and installability
- `docs/security-review.md` — Slice 11 security review
- `docs/samples/README.md` — the bank CSV format

## Page template

New pages follow the same shape:

```markdown
# <Feature>

<One paragraph: what the user gets.>

## Using it
<Where it is in the UI and what each action does.>

## How it works
<Rules, algorithms, edge cases, what triggers what. Numbers and thresholds included.>

## Code
<Key files: pure logic in src/lib, queries in src/db/queries, UI in src/app. Migrations.>

## Tests
<Where the unit / DB / E2E tests are.>

## Related
<Links to other feature pages and SPEC.md sections.>
```
