/**
 * Whole-percent shares of a total, from integer cents only.
 *
 * Plain rounding can make a list add up to 99% or 101%, so this uses the
 * largest-remainder method: every part gets floor(part * 100 / total), then the
 * points still missing go to the parts with the largest remainders (earlier parts
 * win ties). The result always adds up to 100 when the total is positive.
 * A zero or negative total (or a negative part) yields all zeros.
 */
export function percentShares(cents: readonly number[]): number[] {
  const total = cents.reduce((sum, c) => sum + c, 0);
  if (total <= 0 || cents.some((c) => c < 0)) return cents.map(() => 0);

  const scaled = cents.map((c) => c * 100);
  const shares = scaled.map((s) => Math.floor(s / total));
  let missing = 100 - shares.reduce((sum, s) => sum + s, 0);
  const byRemainder = scaled
    .map((s, index) => ({ index, remainder: s % total }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (missing <= 0) break;
    shares[index] += 1;
    missing -= 1;
  }
  return shares;
}

/** A non-zero amount whose share rounds to 0 is displayed as "<1%", never "0%". */
export function isUnderOnePercent(cents: number, share: number): boolean {
  return cents > 0 && share === 0;
}
