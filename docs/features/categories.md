# Categories

Your own two-level category tree (e.g. "Housing > Furniture"), with colors and emoji icons.

## Using it

**More > Categories** (`/settings/categories`, in the 50 F look, Slice 60 / SPEC §75) shows a line "12 categories · this month's spending", then **one card per top-level category**: a 32 px tile in the category's colour holding its emoji, the full name (it wraps, never cut), a **budget** pill when it has a budget, and this month's outflows in euros and cents (subcategories rolled up) **only when above zero**. Its subcategories sit under it (a colour square, name, spending when above zero), then a **＋ Subcategory** row. Nothing is folded away.

- **New category** (full-width button above the tab bar) opens a sheet to **create** a category, optionally under a parent (making it a subcategory).
- **Tap a row** (or ⋯ > **Rename, icon, colour**) opens the edit sheet (`?edit=<id>`): **rename, recolor, move** (to another parent, or back to top level).
- **Icon**: an emoji picker (searchable in the UI language, works on a phone), with **Remove icon**. Shown for every category, subcategories included.
- **＋ Subcategory** at the end of each card (`Add a subcategory to …`) and ⋯ > **Add a subcategory** open the same create sheet, with the parent and the next shade of its colour preset.
- ⋯ > **Set a budget**: opens that category's budget sheet (`/settings/budgets?edit=<id>`).
- ⋯ > **Delete**: at once with **Undo** when nothing uses the category, otherwise a sheet with the choices below.

New users start with **no categories**. The first import offers to create them from the bank's categories (see [Categorization](categorization.md#bank-categories)). Any empty category picker explains how to get categories (import a file, or create one). With no categories, More > Categories says "No categories yet" with **Add a category**.

## How it works

### Hierarchy

- `categories.parent_id` with a composite FK to the same user's category. **Two levels maximum**: a parent must be top-level, and a category with subcategories can't become a subcategory. Enforced by pure functions (`hierarchy.ts`) inside the write transaction with the rows locked.
- Names are unique **per parent**, so "Housing > Other" and "Transport > Other" can coexist.
- Transactions, rules, budgets and split parts can point at a parent or a subcategory.
- When moved, a category's transactions and rules follow it.
- The parent field of the category form is a row of pills (**None (top-level)** then the top-level categories; disabled when the category has subcategories). Other pickers are native selects in tree order, labelled like `🏠 Housing > Furniture`.
- Filtering or budgeting on a parent includes its subcategories; the dashboard rolls subcategory spending up into the parent.

### Deleting

- **Nothing uses it** (no transactions or split parts, rules, subcategories, budget or bank mapping): deleted at once (`deleteCategoryIfUnused`, row locked), with a "Deleted · Undo" toast. Undo (`restoreCategory`) recreates it with the same id, name, colour, icon and parent; it is refused if the name is now taken or the parent is gone. Rule-suggestion dismissals aren't counted and don't come back.
- **Otherwise** a sheet shows the choices with their counts, says it can't be undone, and deletes on **Delete**:
  - **A subcategory**: move its transactions (keeping their source), rules and split parts to the parent (default), or uncategorize them and delete its rules.
  - **A parent with subcategories**: keep the subcategories as top-level categories (default; refused if a name clashes at top level), or delete them too. The parent's own transactions are uncategorized and its rules deleted either way.
- Deleting a category also deletes its budget, bank mappings (the next import asks again) and rule-suggestion dismissals. One DB transaction.

### Colors

Stored colors never change on their own. In dark mode, `categoryDisplayColor` lifts colors that are too dark to a lightness of at least 0.72 (OKLCH, same hue), so chart slices, dots and bars stay readable.

- **Colour field** (Slice 51, redone in Slice 60): the 12 palette swatches (a dot marks one another category already uses), then "Or an exact colour": a live swatch, the hex text field and the phone's own picker (**Colour picker**), all kept in sync; typing a hex that matches a swatch selects it (`parseHexColor`: optional `#`, any case, exactly 6 digits; stored lowercase with `#`). A colour another category already has shows "Used by Groceries" under the field. Each list row shows its colour as a tinted circle (`categoryTint`), readable in dark mode.
- **Palette** (Slice 35): `CATEGORY_PALETTE`, 12 colours distinct from each other, from the brand blue and from the money red and green. Each is at least 3:1 on a white card.
- **"Create all"** from bank categories: a top-level category gets the first palette colour the user doesn't use yet (`nextCategoryColor`, cycling when all are taken). A subcategory gets a shade of its parent's colour (`subcategoryShade`: alternating darker and lighter steps; a lighter step under 3:1 on white goes darker instead), so a family reads as one group and siblings differ.
- **Add a category** proposes the next unused palette colour; **Add subcategory** proposes the next shade of the parent.
- **Recolour migration** `0023_tricolore_category_colors`: categories still on one of the 12 colours the old "Create all" used (`LEGACY_BANK_CATEGORY_COLORS`, never picked by hand) were recoloured the same way, in creation order, skipping palette colours the user already uses. Other colours were left alone. A subcategory whose parent isn't on the palette got a palette colour.

### Icons

- **Default emojis** (Slice 35): "Create all" gives known top-level bank category names an emoji (`src/lib/categorize/bank-icons.ts`: Alimentation 🛒, Logement - maison 🏠, Transports 🚗, Loisirs et vacances 🎉, Shopping et services 🛍️, Banque et assurances 🏦, Transaction exclue 🔁, Santé 🩺, Revenus 💶, Épargne 🐷, Impôts et taxes 🧾; case and accents ignored). Unknown names and subcategories get none. Migration 0023 added them to existing top-level categories with no icon.
- One emoji per category, in `categories.icon`, validated by `categoryIconSchema` as exactly one RGI emoji (skin tones, flags and ZWJ sequences allowed). An empty value clears it.
- **Every category shows its own emoji when it has one, else its colour dot.** A subcategory never falls back to its parent's emoji (SPEC §66, superseding §37). Native options show both parts: `🏠 Housing > 🛋️ Furniture`. Icons stored for subcategories since before §66 show again; nothing was migrated.
- The emoji replaces the color dot wherever both would appear; the name is always next to it.
- Recurring items show the icon of their latest charge's category, subcategories included.
- The picker ([frimousse](https://github.com/liveblocks/frimousse) + `emojibase-data`) is lazy-loaded only when the dialog opens. Emoji data is self-hosted at `/api/emoji-data/{en,fr}/…` and cached by the service worker, so it works offline once used.

### Create from the picker

Slice 54. Missing category while categorizing? No need to leave the transaction.

- In the searchable category list (detail sheet, Review card, the list's swipe picker) a **Create "{search}"** row ends the list when no category (any level) has exactly that name, accents and case ignored (`canCreateFromSearch`; "Uncategorized" counts as a name). It also shows in the "No category matches" state.
- It opens a form in place: the Settings form (`CategoryForm`), name prefilled and focused, optional emoji, colour and parent. Back returns to the list with the search kept; nothing exists until **Create and use**.
- Defaults: top level, and the next free palette colour. When the only matches are subcategories of one parent, that parent is selected and the colour is the next shade of its colour (`defaultCreateParentId`, same shades as "Add subcategory").
- Same action and validation as Settings (`createCategoryAction`, Zod `categoryInput`, `createCategory` scoped by `user_id`), so a duplicate name per parent shows the same inline error and the form stays open for another try. The action returns the new category, so the pick does not wait for the page refresh; other open pickers and filters get it with the refresh the action triggers.
- Bulk edit uses native selects, not the picker: both (Transactions bulk bar, Review's bulk row) end with **New category…**, which opens the same form in a sheet and applies the new category to the selection.

## Code

- `src/app/(app)/settings/categories/` — More > Categories UI (`category-list.tsx`, `category-form.tsx`, `color-field.tsx`, `delete-category-sheet.tsx`); shared list pieces in `src/components/manage/` (row ⋯ menu, Add button, `?add`/`?edit` sheet state)
- `src/lib/categorize/picker-create.ts` — exact-match rule, default parent; `src/app/(app)/transactions/new-category-form.tsx`, `new-category-sheet.tsx`
- `src/lib/categorize/hierarchy.ts`, `icon.ts`, `schemas.ts`, `bank-icons.ts`
- `src/lib/category-color.ts`
- `src/components/category-marker.tsx` — dot or emoji marker
- `src/db/queries/categories.ts`
- `src/app/api/emoji-data/` — emoji data route
- Migrations `0005_category_parent`, `0023_tricolore_category_colors`

## Tests

`src/lib/categorize/hierarchy.test.ts`, `icon.test.ts`, `bank-icons.test.ts`, `src/lib/category-color.test.ts` (hex parsing, tint), `src/db/category-colors-migration.test.ts`, `src/db/queries/categories.test.ts` (including delete with Undo and this month's spending), `category-icons.test.ts`; `e2e/categories.spec.ts` (Add sheet, ⋯ rename, add a subcategory, delete with Undo, the choices sheet, long names wrap), `subcategories.spec.ts`, `category-icons.spec.ts`; Slice 54: `src/lib/categorize/picker-create.test.ts`, `categories.test.ts` ("create from the picker"), `e2e/create-category.spec.ts`.

## Related

[Categorization](categorization.md) · [Budgets](budgets.md) · [Dashboard](dashboard.md) · `SPEC.md` §26, §27, §35, §37 (superseded by §66), §66
