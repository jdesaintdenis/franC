import { swipeAxis } from "../review/swipe";

export type RowSwipeOutcome = "category" | "more" | null;

/** A swipe commits after this share of the row's width... */
export const ROW_SWIPE_RATIO = 0.35;
/** ...but never under this many pixels, so narrow rows still need a deliberate drag. */
export const ROW_SWIPE_MIN_PX = 72;
/** The row follows the finger up to this share of its width. */
export const ROW_MAX_OFFSET_RATIO = 0.6;

/** Which way a row may be dragged; both by default. Other lists enable only what they offer. */
export interface SwipeDirections {
  right: boolean;
  left: boolean;
}

export const BOTH_DIRECTIONS: SwipeDirections = { right: true, left: true };

/**
 * What a finished drag on a row means: right changes category, left opens more actions.
 * `category` is simply the right side and `more` the left one for lists that map them to
 * other actions (the regular payments list: right = confirm, left = dismiss).
 */
export function rowSwipeOutcome(
  dx: number,
  dy: number,
  width: number,
  directions: SwipeDirections = BOTH_DIRECTIONS,
): RowSwipeOutcome {
  if (width <= 0 || swipeAxis(dx, dy) !== "horizontal") return null;
  if (Math.abs(dx) < Math.max(width * ROW_SWIPE_RATIO, ROW_SWIPE_MIN_PX)) return null;
  if (dx > 0) return directions.right ? "category" : null;
  return directions.left ? "more" : null;
}

/** Limits how far the row can be dragged either way; a direction that is off doesn't move it. */
export function clampRowOffset(dx: number, width: number, directions: SwipeDirections = BOTH_DIRECTIONS): number {
  const max = Math.max(0, width) * ROW_MAX_OFFSET_RATIO;
  const clamped = Math.min(max, Math.max(-max, dx));
  if (clamped > 0 && !directions.right) return 0;
  if (clamped < 0 && !directions.left) return 0;
  return clamped;
}
