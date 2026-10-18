---
name: franC
description: A household budget that reads like the last 50 F banknote, at night.
colors:
  night: "#04051a"
  note-blue: "#121638"
  popover-blue: "#161b42"
  ink-wash: "#1b2150"
  gauge-off: "#1d2350"
  engraved-edge: "#232a5c"
  input-edge: "#2b3368"
  moon-paper: "#eeeaff"
  faded-ink: "#9a9fc6"
  periwinkle: "#8ea2ff"
  desert-sand: "#f3e3a6"
  lamp-amber: "#ffb05a"
  mint: "#7fe0b0"
typography:
  hero-amount:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "54px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontFeature: "lnum, tnum"
  section-title:
    fontFamily: "Cinzel Variable, Georgia, serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.14em"
  figure-large:
    fontFamily: "Manrope Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    fontFeature: "tnum"
  balance:
    fontFamily: "Manrope Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    fontFeature: "tnum"
  body:
    fontFamily: "Manrope Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
    fontFeature: "tnum"
  label:
    fontFamily: "Manrope Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    fontFeature: "tnum"
rounded:
  gauge: "2px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "9999px"
spacing:
  gauge-gap: "3px"
  section-gap: "8px"
  card-padding: "14px"
  hero-padding: "16px"
  gutter: "16px"
  gutter-desktop: "32px"
components:
  card:
    backgroundColor: "{colors.note-blue}"
    textColor: "{colors.moon-paper}"
    rounded: "{rounded.lg}"
    padding: "{spacing.card-padding}"
  hero-panel:
    backgroundColor: "{colors.note-blue}"
    textColor: "{colors.desert-sand}"
    rounded: "{rounded.lg}"
    padding: "{spacing.hero-padding}"
  day-chip:
    backgroundColor: "{colors.ink-wash}"
    textColor: "{colors.moon-paper}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  button-primary:
    backgroundColor: "{colors.periwinkle}"
    textColor: "{colors.night}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.ink-wash}"
    textColor: "{colors.moon-paper}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
  section-link:
    textColor: "{colors.periwinkle}"
    typography: "{typography.section-title}"
    height: "44px"
  gauge-block-on:
    backgroundColor: "{colors.periwinkle}"
    rounded: "{rounded.gauge}"
    height: "12px"
  gauge-block-warning:
    backgroundColor: "{colors.lamp-amber}"
    rounded: "{rounded.gauge}"
    height: "12px"
  gauge-block-goal:
    backgroundColor: "{colors.desert-sand}"
    rounded: "{rounded.gauge}"
    height: "12px"
  gauge-block-off:
    backgroundColor: "{colors.gauge-off}"
    rounded: "{rounded.gauge}"
    height: "12px"
  attention-icon-warning:
    backgroundColor: "rgb(255 176 90 / 0.16)"
    textColor: "{colors.lamp-amber}"
    rounded: "{rounded.xl}"
    size: "40px"
---

# Design System: franC

## Overview

**Creative North Star: "The Last 50 F Note"**

franC looks like the 1993 Saint-Exupéry 50 franc banknote held up under a lamp at night: deep night blue, a periwinkle engraving colour, a sand-coloured value, faint guilloché rosettes and a few stars. The name already says *franc* and *français*; the look says it again, quietly. It is a household tool, not a bank and not an AI product, so it avoids the cool grey "fintech" look, gradients on numbers, and glow.

It is an **Operate** surface used on a phone, one hand, a few seconds at a time. The banknote world lives in a few precise places (the hero value panel, the engraved section titles, the francs line on Home, the page's faint rosettes). Everything else is calm, solid, dark cards with clear numbers in Manrope. One answer leads each screen; on Home it is Reste à vivre, set in an engraved serif like a note's face value.

**Status (2026-10-08):** this is the target system for the whole app and the only theme it will have (dark only). It ships on Home (Slice 57, SPEC §72), Opérations and the À valider queue (Slice 58, SPEC §73) and the Budget page at `/budget` (Slice 59, SPEC §74) and the lists you manage (Categories, Budgets and Goals settings, Paiements récurrents; Slice 60, SPEC §75) and the navigation, Accounts tab and Plus page (Slice 61, SPEC §76) , Import and Bank (Slice 62, SPEC §77), Next month and Year (Slice 63, SPEC §78), then the Goals account card and the folded confirmed payments (Slice 64, SPEC §79) through the `.theme-50f` class. Every page, bar, toast, loading skeleton and error page now wears it; the Tricolore tokens left in `:root` are only a fallback and not a rule. Year's month-by-month net bars (up from an axis when positive, amber down when negative, best month mint, current month hatched) and Next month's "What's left" figure (mint when positive, amber when negative, never red) follow the same card, sans-amount and no-francs rules. Variants in the other last-series note colours (100 F Cézanne, 200 F Eiffel, 500 F Curie) may come later as alternative palettes on the same structure.

**Key Characteristics:**
- Dark only: night page `#04051a`, solid note-blue cards `#121638` one step lighter, so cards stand out from the patterned page.
- One accent, periwinkle `#8ea2ff`, for links, the active tab, section titles, charts and gauges.
- Sand `#f3e3a6` is reserved for the hero amount, goal gauges and regular payments (paid solid, due hatched) in budget gauges.
- Amber `#ffb05a` is the only alarm colour. Red is never used, on amounts or anywhere else.
- Three fonts with fixed jobs: Manrope for all text and numbers, Cormorant Garamond for the hero amount only, Cinzel capitals for titles.
- Ten-block gauges instead of smooth progress bars.
- Each section is its own titled card. No horizontal scroll at any width.

## Colors

A night-blue banknote palette: one cool accent, one warm value colour, one warm alarm.

### Primary
- **Periwinkle** (#8ea2ff): the engraving ink. Links, section titles and their links, the active tab and its indicator, focus rings, the pace chart line and area, budget gauge blocks, the hero frame (at 40 % alpha) and its faint "50" (at 7 %). Text on a periwinkle fill is Night.

### Secondary
- **Desert Sand** (#f3e3a6): the face value. The big Reste à vivre amount, goal gauge blocks, regular payments inside budget gauges (paid solid, still due hatched) and the gold star of the background pattern. Never body text, never a button.

### Tertiary
- **Lamp Amber** (#ffb05a): every warning. Over-budget and ahead-of-pace gauges and percentages, a negative Reste à vivre amount, the new price in a price rise, "fast pace" notes, and `--destructive` (destructive buttons are amber too). Soft fill: amber at 16 % alpha behind warning icons.
- **Mint** (#7fe0b0): positive money status (income, a good result). Soft fill at 14 % alpha. Used sparingly; most numbers stay Moon Paper.

### Neutral
- **Night** (#04051a): page background, under the rosette pattern. Also text on periwinkle.
- **Note Blue** (#121638): solid card surface, sidebar, hero panel base.
- **Popover Blue** (#161b42): sheets, popovers, menus.
- **Ink Wash** (#1b2150): secondary/muted/accent fills: the day chip, secondary buttons, hover rows, goal icon tiles.
- **Gauge Off** (#1d2350): empty gauge blocks.
- **Engraved Edge** (#232a5c): card borders and row dividers.
- **Input Edge** (#2b3368): form field borders.
- **Moon Paper** (#eeeaff): primary text and numbers.
- **Faded Ink** (#9a9fc6): secondary text, captions, the francs line, chart labels, struck-through old prices.

### Named Rules
**The No Red Rule.** Red never appears inside the 50 F system. Money that needs attention is amber; nothing is ever "an error" in red. `--destructive` is amber.

**The Sand Is Money Rule.** Sand marks money you have: the hero amount and savings goals. Nothing else takes it.

**The One Ink Rule.** Periwinkle is the only accent. A new state gets a meaning from amber or mint, not a new hue. Category colours appear only as category markers (tinted icon tiles at 18 % alpha), never as UI chrome.

## Typography

**Display Font:** Cormorant Garamond 700 (with Georgia, serif)
**Body Font:** Manrope Variable (with ui-sans-serif, system-ui)
**Title Font:** Cinzel Variable (with Georgia, serif)

**Character:** Manrope is a plain, modern sans that keeps every number easy to read; Cinzel and Cormorant bring the engraved banknote voice in small, rare doses. All three are self-hosted through `@fontsource` (no font host in the CSP).

### Hierarchy
- **Hero amount** (Cormorant Garamond 700, 54px, line-height 1, tight tracking, lining + tabular figures): the Reste à vivre figure only, in Sand (Amber when negative). Must fit "-12 345 €" at 360 px width.
- **Section title** (Cinzel 600, 12px, 0.14em tracking, uppercase, Periwinkle): every section heading and the page title. The section's link on the right uses Cinzel 600 at 13px.
- **Large figure** (Manrope 800, 22px, tabular): the percentage beside a gauge.
- **Sheet amount** (Manrope 700, 36px, tabular): the amount at the top of the transaction sheet.
- **Day title** (Cinzel 600, 13px, 0.08em tracking, Periwinkle): the date on each day card of the Opérations list.
- **Balance** (Manrope 700, 19px, tabular): account balances.
- **Body** (Manrope 400-600, 14-15px): row names (600), sentences such as the per-day line (15px).
- **Label** (Manrope, 11-13px): captions, "312 € sur 450 €", freshness ("Banque, à 07:02"), the francs line (12px, Faded Ink), chart labels (10px).

### Named Rules
**The One Serif Number Rule.** Cormorant Garamond sets exactly one number per screen: the hero amount. Every other number, including the amount in the transaction sheet, is Manrope with tabular figures (`font-variant-numeric: tabular-nums` is the body default).

**The Francs Whisper Rule.** The amount in old francs (× 6,55957, legal rate, no inflation adjustment) appears in the Home Reste à vivre card only, nowhere else, and sits under the euro figure, right-aligned with it, 12px Faded Ink, and never extends past the euro amount's right edge. It is a wink; it never competes.

## Layout

Mobile-first single column; desktop is a second layout, not a stretched phone.

- **Lists:** Opérations groups rows into day cards (below); a sticky day header keeps `bg-background` so rows slide under it. Chips for active filters wrap onto several lines, never scroll sideways.
- **Page:** centred column, `max-width: 672px` (Tailwind `max-w-2xl`), 16px side gutter, 32px from `md`. From `lg` the column widens to 1024px and the sections split into two columns (`grid-cols-2`, 24px column gap, items start).
- **Rhythm:** 8px between sections; each section is a title line (with 8px top padding) over its card. Cards pad 14px; the hero pads 16px. List rows are 12px tall-padding rows divided by Engraved Edge hairlines; rows reaching the card edge use a flush card.
- **Budget page** (`/budget`, any month): one column on a phone; order Le mois, Où est passé l'argent, Budgets, À venir, Objectifs, Solde, Aller plus loin; from `lg` two columns, Le mois and Où est passé l'argent on the left, Budgets, À venir, Objectifs, Solde and Aller plus loin on the right. The page header carries the month title (arrows around a month button that opens a month grid sheet).
- **Row shape:** budget and goal rows are a three-column grid: 32px icon tile, name + detail line, big percentage; the gauge spans under the name. Long names truncate to one line; detail lines wrap.
- **Lists you manage** (`/settings/categories`, `/settings/budgets`, `/settings/goals`, `/recurring`): one column, same section-card rhythm. The page's one "add" action is a full-width Periwinkle button stuck above the tab bar, in thumb reach (`BottomAddButton`, 48px tall, a Night fade behind it), not a header button. Row actions live in a ⋯ menu; the common one (add money to a goal) is a visible ＋ on the row.
- **Navigation:** bottom tab bar (64px plus safe area) under `lg`; sidebar from `lg`. Both take the 50 F look on every page; the app is always dark, sign-in included.
- **Accounts** (`/accounts`): total card, one flush card of accounts (32px tile, name, caption in Faded Ink or Amber when overdue, bold balance), then bank sync and CSV import sections. Imports for accounts without a bank link live here, not behind a raised button.
- **Plus** (`/settings`): short flush list (Classement, Vos données, Langue, Compte franC); counts show only when non-zero; no theme picker.
- **Touch:** every link and control is at least 44px tall (`min-h-11`), including section links.
- **Never** horizontal scroll at any width.

## Elevation & Depth

Flat, tonal layering. Depth comes from the page being darker (and patterned) than the solid cards, plus 1px Engraved Edge borders. There are no ambient drop shadows on cards.

### Shadow Vocabulary
- **Value-panel rule** (`box-shadow: inset 0 0 0 4px var(--card), inset 0 0 0 5px rgb(142 162 255 / 0.27)`): the hero's inner engraved rule, drawn 4px inside its 1px periwinkle border. Structural, not a lift.

### Named Rules
**The Pattern Below, Solid Above Rule.** Guilloché rosettes and stars live on the page background (`.bg-50f`) and inside the hero value panel only. Ordinary cards are solid Note Blue so their content reads cleanly.

**The No Glow Rule.** No glow, no gradient on numbers, no neon. The only gradient fills are the background pattern and the pace chart's area under the line.

## Shapes

Soft rectangles, small radii. Base radius 10px (`--radius: 0.625rem`): cards and the hero use 10px, buttons and inputs 8px, focus rows 6px. Icon tiles are 10px (32px tiles) or 14px (40px attention tiles). Gauge blocks are tiny 2px squares. Pills (day chip, review badge) are fully round. The hero is the one framed shape: 1px periwinkle border plus an inner rule, like the value panel on a banknote, with a faint "50" in Cormorant at 130px bleeding off its bottom-right corner.

## Components

### Buttons
Quiet and solid; buttons are rare on 50 F screens (Home has none).
- **Shape:** 8px radius, 36px tall (32px small, 40px large).
- **Primary:** Periwinkle fill, Night text.
- **Secondary:** Ink Wash fill, Moon Paper text.
- **Destructive:** Amber (never red).
- **Hover / Focus / Active:** 90 % fill on hover; 3px ring in Periwinkle at 50 %; scale 0.98 on press, 150ms ease-out.

### Chips
- **Day chip** ("Jour 5 / 31"): Ink Wash pill, 12px bold Moon Paper, `2px 10px` padding.
- **Review badge:** Periwinkle pill with Night 10px figures on the Transactions tab.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** Note Blue, solid.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px Engraved Edge.
- **Internal Padding:** 14px, or flush for edge-to-edge lists.
- Each card sits under its own Cinzel section title (`HomeSection`), with an optional link on the right.

### Inputs / Fields
Forms live in Popover Blue sheets (`theme-50f`): Input Edge border, 8px radius, Periwinkle 3px focus ring at 50 %. Amount fields offer preset pills (Ink Wash, fully rounded, 44px) that fill the field; a preset equal to another is hidden. Colour is a 6-column grid of twelve swatches (40px, selected one outlined in Moon Paper, a dot when another category already uses it) with the exact hex field and the phone's own colour picker beneath.

### Day card and transaction row (signature)
One card per day on Opérations: a Note Blue header (rounded top, hairline below) with the Cinzel date on the left and the day's total on the right (Mint when positive, Faded Ink otherwise), then flush rows in Note Blue, the last one rounded at the bottom. A row is a 64px-minimum line: category icon tile carrying a 16px mark at its bottom-left (empty Amber ring while to review, filled Mint ✓ once validated, none when ignored), name, Faded Ink detail line (`Non catégorisée` in Amber when bare), amount in Manrope, then a 44px ✓ button in Periwinkle. Swiping right validates (Periwinkle "Valider" behind the row), or opens the picker when the row has no category; swiping left shows "Catégorie".

### Transaction sheet and suggestion pills (signature)
A modal sheet in Popover Blue under `theme-50f`. The amount leads (Manrope 36px, no francs line), then the category as pill buttons: up to four suggestions (Ink Wash fill, fully rounded, 44px tall; from the merchant, the label and recent choices, padded with the most used), a dashed Periwinkle "+ Nouvelle" pill that opens the same category form as Settings, and a Periwinkle "Valider en X" button. Ignore and Delete sit in a danger zone card with an Amber-tinted border at the bottom.

### Manage rows and sheets (signature)
Budgets, goals and categories reuse the Budget page's row (icon tile, name + detail line, big percentage, block gauge) so a list and its summary look the same. Categories are one card per category with its subcategories as indented rows (emoji when set, otherwise a colour square) and the month's spend only when it is not zero. Edit, delete and move live in the ⋯ menu; deleting a category that has transactions opens a sheet asking where they go. Goals also has one **account card** per account that holds goals, under the summary card: the account name and bold balance on one line, "assigned · to assign" in Faded Ink with the left-to-assign part in Amber ("all assigned" at zero), and a Sand gauge of the assigned share; over-assigned turns the figure and gauge Amber, no balance shows a Faded Ink link to Accounts.

### To confirm block (signature)
Top of Paiements récurrents, a Note Blue card with an Amber-tinted border (`border-warning/45`) under its Cinzel title: one detected payment at a time (name, amount, last dates, history chips in Ink Wash) with two 52px buttons, ✕ Ignore (Ink Wash) and ✓ Confirm (Periwinkle). "Voir la liste" swaps to a list of the same payments with ✓ and ✕ per row; the choice is remembered on the device. It disappears when nothing is waiting. The confirmed payments sit below, with a headline of what they cost per month and per year. Each confirmed list (Factures et abonnements, Revenus) shows 4 rows, then a full-width 44px Periwinkle text button on a hairline ("Voir les N autres", which becomes "Voir moins"); rows with a price alert or "Résilié ?" are never folded away.

### Flow totals (signature)
Money in, money out and net as three columns of a `dl`, separated by hairlines: Faded Ink 12px label over a bold Manrope figure (16px, 15px small). Only "in" is Mint; out and net stay Moon Paper, signs come from the figure (`+` only for gains). Used on the import preview and result, so a file's effect reads at a glance before anything is saved.

### Sticky action bar (signature)
Flows with one decision (import preview, bank link form) end in a bar pinned above the bottom tabs (`bottom: 4rem + safe area`): a Night-to-transparent fade behind a full-width Periwinkle button (Ink Wash when the primary move is "Choose another file"), with one quiet text button under it (Cancel, or "Record this import anyway" when the file only merges). From `lg` the bar is static at the end of the content. Never a header button.

### Account pills (signature)
A `radiogroup` of fully round pills, 44px tall: selected pill is Periwinkle fill with Night text, others Ink Wash. Used to pick the account a file goes to; a bank account shows its name and last four digits (`name ••1234`).

### Import result and checklist (signature)
Confirmed imports swap the preview for a Note Blue card: the imported count, its date range in Cinzel, a "To do" list of attention rows (bulk review, transfers, price rise, each with an arrow link that has an accessible name), then "Import another file" and a quiet "Undo this import" in a dialog. The first-run checklist uses the same bones: a four-block Mint progress strip (`bg-positive` / `bg-gauge-off`), then divided rows with a 24px check tile, the next step in bold Periwinkle with its hint, done steps in Faded Ink. Bank connection comes first, for the owner only.

### Bank link picker (signature)
Each bank account is a button row (name and last four digits, the linked franC account or "Create new") that opens a Popover Blue choice sheet; one shared "sync from" date sits under the list (default 90 days back, never earlier). The connection card shows balances, a full-width Sync now, and a ⋯ menu (Change links, Disconnect bank); the empty state is a card with three plain facts and "Choose my bank".

### Navigation
- **Bottom bar:** Night background with a 1px Engraved Edge top border, five equal tabs (Home, Transactions, Plan, Accounts, More; no raised button). Inactive tabs Faded Ink; the active tab is Periwinkle, semibold, with a 2px Periwinkle bar on top so state is never colour alone.
- **Sidebar (lg+):** Note Blue, same colour logic, same five entries (no Import button); the wordmark's C is sand.
- **Month title:** a Periwinkle-tinted 44px square arrow on each side of a month button (Moon Paper bold 14px, chevron). The next arrow is dimmed at the current month. The button opens a Popover Blue grid sheet of twelve months, each cell showing the month's spending, empty months greyed.

### Reste à vivre value panel (signature)
The hero card (`.hero-50f`): banknote frame, its own rosettes, 45° hatching and two stars over Note Blue, faint "50" in the corner. Content top to bottom: "Jusqu'au 31 oct." caption with the day chip; the engraved Sand amount; the francs line; "Environ 58 € par jour pendant 26 jours"; the pace chart; a "how it's worked out" sheet link.

### Pace chart (signature)
Cumulative spending as a 2.5px Periwinkle line over a fading Periwinkle area (35 % to 0), against a dashed even-pace line (35 % alpha) to the month's end, with a vertical hairline and a 10px Periwinkle dot for today. Labels are 10px Faded Ink HTML so they never stretch. Decorative (`aria-hidden`); the sentence above says the same.

### Month card and month bars (signature)
The first card of the Budget page, under its own Cinzel title. The month's spending leads (Manrope, large), then a Faded Ink line (planned amount, what is left in Mint or the overshoot in Amber, the day count, or the change against the previous month), income and net. Below, six month bars: Ink Wash bars for other months, a Periwinkle bar for the selected one, a hatched bar when a month is the current one still running, and a dashed outlined bar for next month's recurring payments. A dashed hairline marks the planned total and is labelled `prévu`. Each bar is a link to its month. A one-line verdict closes the card ("Il reste 432 € sur 960 € de budgets, pour 24 jours", or how a finished month ended); it is hidden when there is nothing to say.

### Category ring (signature)
"Où est passé l'argent": a Periwinkle-family donut in the categories' own colours with the month's total at its centre, then the four biggest categories as rows (colour tile, name, amount, share, a thin bar in the category colour), and a "Toutes les catégories (N)" link that expands the rest. Tapping a slice or a row opens the category's breakdown in place. The chart is decorative (`aria-hidden`); the rows carry the same data.

### Month balance curve (signature)
The Solde card on the Budget page shows the selected month's balance as a Periwinkle area. The part already lived is solid; the part still to come in the current month is dashed (recurring payments plus the rest of the budgets spread per day). A dashed Amber line marks the low-balance threshold. The ends and the lowest point are labelled in Faded Ink; the lowest point carries a 10px dot. It stays on every month so curves can be compared month to month.

### Block gauge (signature)
Ten 12px-tall blocks with 3px gaps, one per 10 %, a half block from 5 %. Periwinkle for budgets, Amber when over or ahead of pace, Sand for goals; empty blocks Gauge Off. Budgets add a 2px Moon Paper tick for today's even pace. The big percentage beside it carries the meaning; the gauge is `aria-hidden`.

**Budgets with regular payments** fill each block by segments, in order: payments already paid in Sand, other spending in Periwinkle (Amber when over or ahead of pace), payments still due as hatched Sand (a 135° two-pixel stripe with a thin Sand edge: expected, not done). The pace tick then counts only the rest, starting after the paid payments. Under the gauge, "Reste **X** à dépenser" in 11px Faded Ink with the amount in Moon Paper (Amber when the due payments overshoot). On the Budget page a list follows, one line per payment: a 14px Mint disc with a check when paid, a Sand ring when due, then name, date and amount (Sand while due). Budgets the payments fill entirely fold under a Periwinkle "Voir les N budgets de prélèvements" link.

### Attention row (signature)
One row per thing to handle, linking to its page: a 40px tinted icon tile (Amber soft for warnings), title and hint, chevron. A price rise reads `Netflix 13,49 15,99 €`: old price struck through in Faded Ink, new price bold Amber. Budgets never get a row: their gauges on Home already show over and fast pace. The first three show; "Tout voir (N)" expands the rest in place. The section is hidden when empty.

### Month strip (signature)
"À venir ce mois-ci" on Home, under Budgets: the month as one 2px Gauge Off line with a 2px Periwinkle tick for today (the days already lived in Engraved Edge). One round dot per day that has a bill, with a 2px card-coloured ring, 8px to 22px by the day's total (capped at 300 €). Bills of 100 € or more are Sand, the others Faded Ink; bigger dots sit on top so a big payment is never covered, and the open dot rises above all. Hit areas stretch vertically only (a neighbour never steals a tap). A tap opens a bubble on Popover Blue just above the dot: bill name bold, amount and date in Faded Ink, the tapped day in full and its neighbours at 60%, three lines at most then "+ N autres". The bubble's edge follows the dot (translated by its share of the width), so it never leaves the card; "aujourd'hui" is clamped inside the card, and "1" or the month's last day give way when it would touch it. Under the strip: a legend (Sand and Faded Ink keys, or "Que des petites factures" in Mint) and the three biggest bills as attention-style rows, amounts Sand from 100 €, never red.

## Do's and Don'ts

### Do:
- **Do** keep the 50 F system dark only; new screens add the `theme-50f` class (and `bg-50f` on the page wrapper) until the roll-out makes it the `:root` default.
- **Do** lead every screen with one answer, and give each section its own Cinzel-titled card.
- **Do** use Amber `#ffb05a` for every warning, over-budget and negative amount.
- **Do** set every number in Manrope with tabular figures, except the one hero amount.
- **Do** show the old price and the new price for a price rise, not "+2,50 €".
- **Do** keep touch targets at least 44px and mark the active state with shape as well as colour.
- **Do** make one tap do one job: choosing a category validates, and ✓ shows only when a row can be validated (it has a category, a split, a confirmed transfer or is ignored). Keep an empty 44px spacer when it is absent so amounts stay aligned.
- **Do** flag a transaction waiting for review with the empty amber ring on its icon (plus a screen-reader label), and a validated one with the filled ✓, never a coloured row.
- **Do** keep a list and its summary on the same row component (`BudgetGaugeRowContent`, `GoalGaugeRowContent`) so the two never drift apart.
- **Do** end a one-decision flow with the sticky action bar and one quiet text button below it; show the money a file will add (in, out, net) before the Import button.
- **Do** keep a mint (`text-positive`) figure to gains and progress only; failure and warnings stay Amber.
- **Do** format money and dates only through `lib/money.ts` and `lib/format-date.ts`.
- **Do** write French month names in lower case inside a sentence (`inSentence`); the month title and sentence starts keep the capital.

### Don't:
- **Don't** use red anywhere, including for errors and destructive actions.
- **Don't** add light-theme values or a theme picker to 50 F screens; Tricolore is legacy, not a reference.
- **Don't** put gradients, glow or neon on numbers; no "banking/AI" sheen.
- **Don't** use Bodoni Moda (its € reads as a C) or any second serif for numbers.
- **Don't** put the rosette pattern on ordinary cards, or let decoration compete with a figure.
- **Don't** allow horizontal scroll at any width.
- **Don't** show the francs line outside the Home card, or set any amount in a serif other than the Home hero.
- **Don't** give a portal (sheet, toast, bulk bar) a hand-picked colour: add `theme-50f` to it so it takes Popover Blue and Note Blue like the page.
- **Don't** put a page's main "add" in the header on a list page: use the sticky bottom button.
- **Don't** show "0 €" for an empty month on a category, or fold dormant categories away.
- **Don't** hide a destructive step (Undo, Disconnect) as a loud button: it sits in a ⋯ menu or a quiet text button and confirms in a dialog.
- **Don't** show actions on Home; it links to the pages where actions happen.
