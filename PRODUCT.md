# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Installable PWA, mobile-first. Desktop is a supported second layout (sidebar, two columns), not an afterthought.

## Users

Two people: Jérémy and his wife, sharing one franC account (one sign-in, one set of data). Nobody else; franC is not built for strangers.

- **Mostly on the phone, in the installed app.** Two jobs dominate:
  - a quick look at how much they are "allowed" to spend (Reste à vivre / safe to spend);
  - categorizing new payments fast, one at a time (the swipe-to-review queue).
- **Sometimes on desktop**, for heavier work: bulk categorizing, rules, budgets, imports, fixing gaps with the bank.

Primary language is French; English is a complete second language.

## Product Purpose

A personal budget manager for one household. It shows where money went, what recurring payments exist, what to expect next month, and above all how much is left to spend this month. Transactions arrive from the bank's daily sync (Enable Banking, Jérémy's accounts only), CSV exports, or by hand (cash, Swile meal card).

Success: the household checks franC instead of guessing, categorizing takes minutes, and the numbers match the bank.

## Positioning

franC is built for this family's needs and nobody else's. It does what they need, the way they want, and is never tied to a third party's choices (feature cuts, upsells, ads, data resale, bank-category guesses they can't override). Their own rules always beat guesses and bank categories.

## Operating Context

- Phone, often one hand, often a few seconds at a time: open, read one number, close; or swipe through a few new transactions.
- Bank sync runs daily at 07:00 UTC and again on app open if the last sync is over 2 h old; CSV import stays for history and gaps.
- Real bank data is in production. Every change must keep existing categories, assignments, rules and synced rows.
- Detailed feature behavior lives in `docs/features/`; decisions and reasons in `SPEC.md`.

## Capabilities and Constraints

- EUR only, amounts in integer cents; fr-FR format `1 234,56 €`, English as en-GB.
- French wording follows `messages/GLOSSARY.md` ("opération", "Paramètres", "Solde" = account balance, "Bilan" = month net, "Reste à vivre").
- Bank sync is restricted to Jérémy's email (`BANK_SYNC_EMAILS`); any other account on the deployment must never connect or import his bank data.
- Out of scope unless asked: envelope budgeting, multi-currency, OFX and other file types, investments or net worth.

## Brand Commitments

Nothing is set in stone; these are the current choices, changeable by Jérémy.

- Name **franC**, with the capital C (franc, français).
- Look: the last 50 F banknote (Saint-Exupéry, 1993), dark only; `DESIGN.md` is the visual system. Shipped on Home (SPEC §72); other pages still use the older Tricolore tokens until they are migrated. Red is never used; amber flags money that needs attention.
- Voice: plain, short, everyday French; no jargon, no marketing tone.

## Evidence on Hand

- Synthetic bank export: `docs/samples/sample-export.csv`.
- Earlier UX review and mockups: `plans/ux-review.md` in the project files, canvas https://claude.ai/artifact/TR8Jv1VdByJoofSEec9gSd.
- Latest Home critique (2026-10-06): `critique/home-2026-10-06-c/` in the project files.
- No testimonials, users or metrics beyond the household; never invent any.

## Product Principles

1. **One answer first.** Each screen leads with the thing they came for (on Home, what's left to spend); details sit one tap away.
2. **Thumb-speed on the phone.** The frequent jobs (check, categorize, confirm) work one-handed in seconds; heavy editing can wait for desktop.
3. **Their rules, not a vendor's.** User choices beat bank data and guesses; nothing is hidden, locked or upsold.
4. **Numbers you can trust.** Show how fresh the data is and how a figure is computed; flag gaps with the bank instead of hiding them.
5. **Never lose their data.** Changes save with Undo; migrations preserve what's already there.

## Accessibility & Inclusion

No specific need. One-handed use is a plus, especially for the swipe review queue.
