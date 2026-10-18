export type SwipeOutcome = "reviewed" | "skip" | "none";

/** A swipe commits after a third of the card's width. */
export const SWIPE_THRESHOLD_RATIO = 1 / 3;
/** Movement below this is a tap or a wobble, not a direction yet. */
export const SWIPE_LOCK_DISTANCE = 10;

/** Which way a drag is going once it has moved far enough to tell. */
export function swipeAxis(dx: number, dy: number): "horizontal" | "vertical" | undefined {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < SWIPE_LOCK_DISTANCE) return undefined;
  return ax > ay ? "horizontal" : "vertical";
}

/**
 * What a finished drag means: right marks the row reviewed, left skips it. Mostly vertical
 * drags (scrolling) and short ones do nothing.
 */
export function swipeOutcome(dx: number, dy: number, width: number): SwipeOutcome {
  if (width <= 0 || swipeAxis(dx, dy) !== "horizontal") return "none";
  if (Math.abs(dx) < width * SWIPE_THRESHOLD_RATIO) return "none";
  return dx > 0 ? "reviewed" : "skip";
}
