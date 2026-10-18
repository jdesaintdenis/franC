/** Actions the review page can trigger from the keyboard. */
export type ReviewShortcut =
  | "next"
  | "previous"
  | "reviewed"
  | "accept"
  | "category"
  | "split"
  | "transfer"
  | "rename"
  | "toggleSelect"
  | "undo"
  | "help";

/** What the mapping needs to know about a key press; a subset of `KeyboardEvent`. */
export interface ShortcutKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** True for auto-repeat, so a held key does not mark a dozen rows. */
  repeat?: boolean;
}

/** The element that had focus, reduced to what decides whether typing is going on. */
export interface ShortcutTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

const TEXT_TARGETS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
// Enter on these already means "activate", so the page must not also treat it as "reviewed".
const ACTIVATABLE_TARGETS = new Set(["BUTTON", "A", "SUMMARY"]);

const KEY_ACTIONS: Record<string, ReviewShortcut> = {
  j: "next",
  arrowdown: "next",
  k: "previous",
  arrowup: "previous",
  r: "reviewed",
  enter: "reviewed",
  a: "accept",
  c: "category",
  s: "split",
  t: "transfer",
  n: "rename",
  x: "toggleSelect",
  u: "undo",
  "?": "help",
};

/** True when the key press belongs to the focused element rather than to the page. */
export function isTypingTarget(target: ShortcutTarget | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return TEXT_TARGETS.has((target.tagName ?? "").toUpperCase());
}

/**
 * Maps a key press to a review action, or null when the page should leave it alone:
 * modifier combos (browser shortcuts), typing in a field, an open dialog, or Enter on a button.
 */
export function shortcutFor(
  event: ShortcutKeyEvent,
  target: ShortcutTarget | null | undefined,
  options: { dialogOpen: boolean },
): ReviewShortcut | null {
  if (options.dialogOpen) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(target)) return null;

  const key = event.key.toLowerCase();
  const action = KEY_ACTIONS[key];
  if (!action) return null;
  if (key === "enter" && ACTIVATABLE_TARGETS.has((target?.tagName ?? "").toUpperCase())) return null;
  // Holding a key down repeats it; only navigation makes sense to repeat.
  if (event.repeat && action !== "next" && action !== "previous") return null;
  return action;
}

/** Keys shown in the help dialog, in display order, with the action they trigger. */
export const SHORTCUT_HELP: ReadonlyArray<{ keys: readonly string[]; action: ReviewShortcut }> = [
  { keys: ["J", "↓"], action: "next" },
  { keys: ["K", "↑"], action: "previous" },
  { keys: ["R", "Enter"], action: "reviewed" },
  { keys: ["A"], action: "accept" },
  { keys: ["C"], action: "category" },
  { keys: ["S"], action: "split" },
  { keys: ["T"], action: "transfer" },
  { keys: ["N"], action: "rename" },
  { keys: ["X"], action: "toggleSelect" },
  { keys: ["U"], action: "undo" },
  { keys: ["?"], action: "help" },
];
