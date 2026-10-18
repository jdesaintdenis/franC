# Feedback, motion and empty states

Every tap visibly does something: results and errors appear in one toast, category changes and confirmations show at once, lists animate quietly, empty screens say what to do next, and loading screens look like the page that's coming.

## Using it

- **The toast** sits at the bottom, above the bottom bar (bottom right on a computer, inside an open sheet when one is open). It says what just happened ("Moved to Groceries", "Marked 3 as reviewed", "Rule saved · 4 transactions categorized") with **Undo** where the change can be reversed. Errors use the same place with a warning icon and offer **Try again** when repeating makes sense. One toast at a time: a new one replaces the old.
- **Field errors** (an invalid amount, an empty name) stay under the field in the form or sheet. Nothing else adds a "Saved" line to the page. Theme and language show nothing when saved: the page changing is the feedback; only a failure shows a toast.
- **Instant changes**: picking a category (swipe picker, detail sheet, bulk Categorize, review card), bulk tag add/remove (for a tag already loaded), Mark reviewed (one, selection, an import, all) and Accept guess change the screen immediately. If the server refuses or the connection drops, the rows go back as they were and an error toast offers Try again.
- **Motion**: rows that leave a list (Regular payments and the lists under Plan and More) fade out and the others slide into place; rows put back by Undo fade in. Progress bars fill from empty and slide to their new width. Buttons and rows darken or shrink slightly when pressed, and buttons doing work show a spinner. Sheets slide up (phone) or zoom in (computer). With the device's **reduce motion** setting on, all of it is off; there is no separate switch in franC.
- **Empty states**: every list says it's empty the same way: a round icon, a short title, one sentence and one button (Transactions → Import your bank export, or Clear filters when filters match nothing; Review → "All caught up"; Regular payments → Look for them now, or Import when there are no transactions; Categories, Rules, Merchants, Goals → Add; Tags → Go to transactions; Bank categories → Import; Budgets → Add a budget with three suggestions; Year → Import or go to the latest year; Next month → See regular payments). Home's cards use a compact version.
- **Phone keyboard**: a bottom sheet sits above the on-screen keyboard and the focused field scrolls into view, so no sheet's field is hidden while typing.
- **Loading**: every page, including each More/Plan screen, shows a skeleton shaped like its layout, with a soft shimmer. Skeletons wear the 50 F look too (night background, `bg-card` rounded cards, 32 px tile markers), as do the not-found and error pages (Slice 63).

## How it works

- **Toast** (`ToastProvider`/`useToast`): `show({ message, variant, undo | action })`. Successes last 6 s in a `role="status"` region; errors 10 s in a `role="alert"` region (both regions are always mounted so screen readers know them). Hover or focus pauses the timer. The toast fades out over 160 ms (at once with reduce motion). The most recently mounted viewport shows it, so an open sheet's own viewport keeps Undo inside the focus trap.
- **Optimistic changes**: the screen applies the change to its rows first (`patchById`), remembering the previous values (`snapshotFields`). Server calls go through one queue per screen (`createSerialQueue`), in tap order, so an Undo tapped while its change is in flight reaches the server after it. On failure `revertPatches` restores the rows unless a newer change touched them since (that newer change wins). The "Always put X in Y?" rule suggestion and bulk success counts appear once the server answers. A brand-new tag added in bulk still waits for the server (it has no id yet).
- **List motion** uses React's `<ViewTransition>` (`ListRowTransition`, view-transition class `list-row` in `globals.css`). Used on Regular payments and the Budgets, Categories, Rules, Tags, Merchants and Goals lists. React only plays it for updates made inside a transition, so plain state changes simply switch. Under reduce motion every class is "none", so no view transition starts at all. The Transactions list (virtualized, rows recycled) and the review card (it holds fields you type in) don't use it: a row update during a view transition swallowed typing in the open detail sheet. Browsers without view transitions change instantly.
- **Sheets above the keyboard**: `SheetContent` follows `window.visualViewport` and sets `--keyboard-inset` (`keyboardInset`, `src/components/ui/keyboard-inset.ts`) and `--visual-height`; the sheet's `bottom` and `max-height` use them, and on a viewport resize the focused field is scrolled into view. From `lg` (no keyboard) it is the centred dialog as before.
- **Reduce motion**: one rule in `globals.css` cuts every animation, transition and view transition to ~0 under `prefers-reduced-motion: reduce`, so no component can forget it.
- **Durations**: ≤ 250 ms for sheets, toasts and rows; 450 ms for a bar filling.

## Code

- `src/components/toast.tsx` — provider, `useToast`, viewport, durations
- `src/lib/optimistic/` — `queue.ts`, `patch.ts`, `category.ts` (pure helpers)
- `src/app/(app)/transactions/category-change.ts` — "Moved to … · Undo" and "Couldn't move it to …" toasts
- `src/components/list-row-transition.tsx` — `ListRowTransition`
- `src/app/globals.css` — keyframes (`toast-pop`, `bar-grow`, `shimmer`), `list-row` view transition, reduce-motion guard
- `src/components/ui/button.tsx` — pressed state and `pending` spinner
- `src/components/empty-state.tsx`, `src/components/manage/empty-add-link.tsx`, `src/lib/empty-state/choice.ts` — empty states and which action they offer
- `src/components/ui/skeleton.tsx`, `src/components/page-header-skeleton.tsx`, `src/components/manage/manage-list-skeleton.tsx`, every `loading.tsx` under `src/app/(app)/`
- Messages: `common.toast`, `common.emptyState`, and each namespace's `empty` keys

## Tests

`src/components/toast.test.ts`, `src/lib/optimistic/*.test.ts`, `src/lib/empty-state/choice.test.ts`; `e2e/feedback.spec.ts` (category change shows before the server answers, a refused save reverts and Try again works, Mark reviewed leaves at once and its Undo lands after the save), `e2e/motion.spec.ts` (with motion on, dismiss and Undo still work; with reduce motion, an open sheet runs no animation), `e2e/empty-states.spec.ts` (each list's empty state and its action), `src/components/ui/keyboard-inset.test.ts`, `e2e/sheet-keyboard.spec.ts` (a focused sheet field stays visible when the viewport shrinks). Playwright runs with reduce motion by default.

## Related

[Transactions](transactions.md), [Review queue](review-queue.md), [Recurring payments](recurring.md), [Language and theme](language-and-theme.md). SPEC §58.
