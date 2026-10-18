/**
 * Sheets opened from a row (or its "⋯" menu) are driven by the URL, so Radix has no trigger to
 * hand focus back to when they close and it lands on <body>. The row remembers where focus
 * should go; a sheet opened right after claims it on open and restores it on close.
 */
let remembered: { element: HTMLElement; at: number } | null = null;
const CLAIM_WINDOW_MS = 2000;

export function rememberReturnFocus(element: HTMLElement | null): void {
  remembered = element ? { element, at: Date.now() } : null;
}

export function claimReturnFocus(): HTMLElement | null {
  const claimed = remembered && Date.now() - remembered.at < CLAIM_WINDOW_MS ? remembered.element : null;
  remembered = null;
  return claimed;
}
