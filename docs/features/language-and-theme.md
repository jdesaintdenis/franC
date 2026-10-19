# Language and theme

The app is available in English and French, and always in the dark 50 F look. The language follows your device by default and your choice once you set it, across devices.

## Using it

**More** (`/settings`), under Preferences, **Language** opens a sheet with:

- **Language**: Automatic (browser language), Français, English. Language names are shown in their own language.
- Picking one saves at once with no "Saved" message (the page changing is the feedback); a failure shows an error toast with **Try again**. Animations follow the device's **reduce motion** setting ([feedback and motion](feedback-and-motion.md)).

Next to it, **Income** chooses which month Reste à vivre counts incoming money for ([Safe to spend](safe-to-spend.md)).

## Language

### How it works

- `next-intl` without locale routing (no `/fr/` in URLs).
- **Resolution** (`src/i18n/request.ts`): saved `users.locale` (null = follow the browser) → `locale` cookie (set when you pick, so the login page follows after sign-out) → best `Accept-Language` match → English.
- **Messages**: `messages/{en,fr}/<namespace>.json` (`common`, `auth`, `dashboard`, `import`, `transactions`, `recurring`, `settings`). French wording follows `messages/GLOSSARY.md` ("opération", "vous", "valider", "Reste à vivre"…). A unit test fails when a key, ICU argument or rich-text tag exists in one language only.
- **Formatting**: French uses `fr-FR` (`1 234,56 €`), English uses `en-GB` (`€1,234.56`). Display time zone is Europe/Paris. Only through `lib/money.ts`, `lib/format-date.ts`, `lib/dashboard/month.ts`.
- **Dates** (Slice 35, `lib/format-date.ts`, string-based, never shifts the day):
  - `formatDay` for list rows (transactions, review, coming up, goal contributions, import preview, transfers): "Today", "Yesterday", "Tomorrow" (from `Intl.RelativeTimeFormat`), else "Mon 28 Sept" / "lun. 28 sept.".
  - `formatShortDay` inside sentences and chart labels ("as of 28 Sept", "next 5 Oct"): no weekday, no relative word.
  - Both add the year only when it isn't the current one. Server components get `today` from `currentDate()`; client components read it from `TodayProvider` (`src/components/today-provider.tsx`, set in the app layout and refreshed when the app comes back to the foreground).
  - `formatDateTime` (short numeric date and time) stays for import history and review batches.
- **Amounts**: lists and details show cents. Headline numbers (safe to spend, the month's totals, the year's totals) use `formatWholeCents`, rounded to the euro.
- **Uncategorized**: spending queries return `name: null` for money without a category; pages label it with `labelUncategorized` (`src/lib/categorize/uncategorized.ts`).
- **Starting account**: named in the sign-up language ("Main account" / "Compte principal", `DEFAULT_ACCOUNT_NAMES`). Migration `0024_localized_default_account` renamed "Main account" for users who had saved French.
- `src/lib` returns codes; translation happens at the UI edge.
- **Not translated**: your category and account names, bank category names (French).
- `<html lang>` and the web manifest follow the active language. The offline and global error pages pick a language from `navigator.languages`.
- CSV [export](export.md) delimiter and decimals follow the language.

## Theme

- **One theme.** Since Slice 61 (SPEC §76) the app is always dark: `<html>` carries `dark` on every page, the theme picker, `theme` cookie and `lib/theme/*` are gone, and `users.theme` is no longer read (the column stays, no migration). The 50 F tokens in `.theme-50f` cover every page except `/budget/next-month` and `/year` (`isFiftyFrancsPath`); those keep the older blue palette, in its dark variant. Sheets and dialogs carry `theme-50f` on their content. Since Slice 63 (SPEC §78) every page, bar and toast wears the 50 F tokens (`theme-50f`): the last two Tricolore pages (Next month, Year) and `isFiftyFrancsPath` are gone, and loading skeletons, the not-found page and the error pages (including `global-error`, with inline night colours) follow.
- **Status bar**: `theme-color` and the manifest use `#04051a` (`src/lib/theme-color.ts`).

## Code

- `src/i18n/request.ts`, `messages/`, `src/i18n/messages.test.ts`
- `src/lib/money.ts`, `src/lib/format-date.ts`, `src/lib/dashboard/month.ts`
- `src/lib/theme-color.ts`
- `src/app/(app)/settings/language-picker.tsx`, `language-actions.ts`, `language-row.tsx`
- `src/app/globals.css`, `src/app/manifest.ts`, `src/app/layout.tsx`, `src/app/icon.tsx`, `apple-icon.tsx`, `icons/`
- `src/components/wordmark.tsx`, `src/components/today-provider.tsx`, `src/lib/categorize/uncategorized.ts`
- Migrations `0004_add_user_locale`, `0012_user_theme`, `0024_localized_default_account`

## Tests

`src/i18n/messages.test.ts`, `src/lib/money.test.ts`, `src/lib/format-date.test.ts`, `src/lib/categorize/uncategorized.test.ts`, `src/db/default-account-migration.test.ts`, `src/db/queries/provision.test.ts`; `e2e/i18n.spec.ts`, `e2e/theme.spec.ts`; `e2e/a11y.spec.ts` runs every main page.

## Related

`SPEC.md` §25, §34, §49, §50
