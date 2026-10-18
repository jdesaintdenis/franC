/** A price increase between the usual and the new charge (both signed cents, outflows negative). */
export function priceIncrease(oldAmountCents: number, newAmountCents: number): { diffCents: number; ratio: number } {
  const diffCents = Math.abs(newAmountCents) - Math.abs(oldAmountCents);
  return { diffCents, ratio: Math.abs(oldAmountCents) === 0 ? 0 : diffCents / Math.abs(oldAmountCents) };
}
