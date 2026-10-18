# Categorization

Transactions get a category in four ways: by hand, by your rules, from the bank's own category, or by a guess from your past choices. Each transaction records how it got its category in `category_source`.

## Precedence

**manual > rule > bank > guess > nothing**

| Source | Set by | Can be replaced by |
| --- | --- | --- |
| `manual` | You (dialog, bulk edit, review, Accept guess) | Only you |
| `rule` | A matching rule | Only you (rules never re-evaluate rule results) |
| `bank` | Your mapping of the bank's category | A rule, or you |
| `guess` | The guesser | A rule, a bank mapping, or you |

Invariant: `category_source` is null exactly when `category_id` is null. Split transactions and (for guesses) transfer legs are never touched by automation.

## Rules

### Using it

- **More > Rules** (`/settings/rules`): suggested rules and **Apply rules now** first, then the list. Each row shows its priority number, the pattern (wraps) with its match type, and the category. **＋ Add** opens the create sheet; tapping a row opens the edit sheet. The ⋯ menu has Edit, Move up, Move down (disabled at the ends), See matching transactions (a search for the pattern; not for regex rules) and Delete. Delete is immediate with **Undo**, which puts the rule back at its place in the order (`restoreRule`, same id); deleting a rule never changed transactions, so neither does Undo. A toast reports "Rule added" or "Rule saved" and how many transactions it categorized. Checkbox "Apply to uncategorized transactions" (on by default) applies rules right away. **Apply rules now** re-runs them; its result is a toast. A suggested rule disappears once created or dismissed. With no rules the page says "No rules yet" with **Add a rule**.
- **Create and use** (Slice 54, [Categories](categories.md)): a category created from the picker is applied like any hand pick: manual source, reviewed, "Moved to … · Undo" toast, rule suggestion or proposal as above. Undo restores the previous category and keeps the new one.
- **From a transaction**: after you change a category by hand in the [detail sheet](transactions.md), a card asks "Always put {pattern} in {category}?" (once the category change has reached the server). **Create rule** creates a `contains` rule and applies it retroactively, with a toast "Rule created · N other transactions categorized · **Undo**"; **Adjust** opens a *New rule* step to change the match type and pattern first; ✕ hides the card. Undo deletes the rule and un-categorizes only the rows it had just categorized that still carry its category from a rule.
- The proposed pattern (`proposeRule`, `src/lib/categorize/propose-rule.ts`, computed by the server in `categorizeTransaction`) is the merchant name when the row has one, else the label's merchant key (the same key as the suggestions below, so "CB CARREFOUR 12/09" proposes "carrefour"). No card when the key is shorter than 3 characters, when your rules already give that category to that label, when you cleared the category, or when a stronger suggestion below applies (that one shows instead).
- Rules can target a subcategory.

### How it works

- Match types: `contains`, `equals`, `regex`. Patterns ≤ 200 characters; regexes are compile-checked on input, and an invalid stored regex never matches.
- A rule matches when **any** of these match: `label_normalized`, the normalized display label, or the [merchant name](merchant-names.md). `contains`/`equals` ignore case and accents; `regex` runs as `RegExp(pattern, "iu")`.
- Evaluated by `priority asc, created_at asc`; **first match wins**. New rules go last.
- Rules only write rows that are uncategorized or have a `bank` or `guess` category.
- On import, rules run at insert time inside the import's transaction.
- Matching runs in JS (not SQL), so regex semantics are the same everywhere.

## Bank categories

The bank export has its own `Categorie` / `Sous categorie` columns. franC keeps them on each transaction and lets you map them to your categories.

### Using it

- The **import preview** lists bank categories and subcategories from the file that you haven't decided on yet, each with **Create**, **Map to** an existing category, or **Ignore**, plus **Create all**. A same-named existing category is preselected as "Map to". Undecided items are asked again next time.
- **More > Bank categories** (`/settings/bank-categories`): mappings grouped by bank category. Changing one re-applies it; **Forget** removes it (rows keep their category) so the next import asks again.

### How it works

- Stored as `bank_category_mappings (bank_category, bank_subcategory, category_id)`; a null `category_id` means Ignored.
- A row gets its **subcategory's** mapping if mapped, else its **bank category's** mapping, else nothing. So ignoring a subcategory falls back to the parent's mapping.
- A created bank subcategory goes under its bank category's target (kept to two levels).
- "A categoriser" placeholders count as no bank category. Bank names are shown as-is, in French.
- Mappings only fill rows with no category, or replace a guess.
- Re-importing an old export **backfills** bank columns on existing rows, so older data can be mapped and guessed too.

## Category guessing

### Using it

- Runs automatically on import for rows still uncategorized after rules and bank mappings ("N categories guessed").
- **Guess categories** on the Review page re-runs rules, re-applies bank mappings, then guesses every uncategorized row; newly guessed rows go back into the review queue.
- Guessed rows are marked (sparkle icon and italics on Transactions, "Guess" badge on Review). **Accept** turns a guess into `manual`; you can also change or clear it.

### How it works

Pure, in `src/lib/categorize/guess.ts`. **No external service**: transaction data never leaves the app.

- **Examples**: your newest 5 000 unsplit, non-transfer rows categorized `manual` or `rule`.
- **Neighbours** of the **same sign** are searched in three tiers, stopping at the first that has any:
  1. same merchant id (weight 1.0),
  2. same merchant key (0.95),
  3. similar label: IDF-weighted Jaccard over key tokens ≥ 0.6 (weight = similarity).
- Each neighbour votes for its category, weighted by recency (half-life 180 days).
- **Confidence** = winning vote share × support (0.8 with one example, 1 with two or more) × tier weight. **Threshold 0.6**: below it, no guess. Examples: one earlier example → 0.76 (guess); Food ×2 vs Restaurants ×1 → 0.63 (Food); one each → 0.5 (none).
- Confidence is never shown or stored.

## Rule suggestions

- After you categorize rows **by hand**, franC suggests a rule when a group (same merchant id, else same merchant key) has **3 or more** manual rows in one category, none in another, no existing rule matches, and you haven't dismissed it.
- The suggested rule is `equals <merchant name>` for a named merchant, else `contains <merchant key>` (≥ 3 characters).
- Shown as "You put N X in Category. Always do this?" with **Create rule** / **Not now**, under the review card or the Transactions toolbar. More > Rules lists up to 10 current suggestions with how many rows each would categorize now.
- **Not now** stores a dismissal (`rule_suggestion_dismissals`).

Savings rules (Slice 52) are separate from category rules: they match the same label key but move the row to a Savings account instead of setting a category. See [Internal transfers](internal-transfers.md#move-to-savings).

## Code

- `src/lib/categorize/rules.ts` — rule matching
- `src/lib/categorize/bank.ts`, `bank-decisions.ts`, `bank-groups.ts` — bank categories
- `src/lib/categorize/guess.ts` — guessing
- `src/lib/categorize/suggest-rule.ts` — suggestions
- `src/db/queries/category-rules.ts`, `bank-categories.ts`, `guess.ts`
- `src/app/(app)/settings/rules/`, `src/app/(app)/settings/bank-categories/`, `src/app/(app)/import/bank-categories-step.tsx`
- Migrations `0006_bank_categories`, `0016_category_guess`

## Tests

`src/lib/categorize/*.test.ts` (matching and priority, placeholders, bank decisions, similarity, confidence threshold, suggestions, precedence), `src/db/queries/category-rules.test.ts` (including delete and restore), `bank-categories.test.ts`, `guess.test.ts`; E2E for rules (sheets, move down from the menu, delete with Undo) in `e2e/categorize.spec.ts`, bank categories and guessing in `e2e/`.

## Related

[Categories](categories.md) · [CSV import](csv-import.md) · [Review queue](review-queue.md) · [Merchant names](merchant-names.md) · `SPEC.md` §7, §19, §27, §41, §54
