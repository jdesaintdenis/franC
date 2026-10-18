/**
 * How far the on-screen keyboard (or anything else shrinking the visual viewport) covers the
 * bottom of the layout viewport, in px. iOS Safari and Android Chrome (by default) shrink only the
 * visual viewport when the keyboard opens, so a `bottom: 0` fixed element ends up behind it.
 */
export function keyboardInset(layoutHeight: number, viewport: { height: number; offsetTop: number }): number {
  return Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop));
}
