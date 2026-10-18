/** (income - spent) / income as a fraction; null when there is no income to compare to. */
export function savingsRate(incomeCents: number, spentCents: number): number | null {
  if (incomeCents <= 0) return null;
  return (incomeCents - spentCents) / incomeCents;
}

/** Whole percent, rounded half away from zero, from integer math only. Null without income. */
export function savingsRatePercent(incomeCents: number, spentCents: number): number | null {
  if (incomeCents <= 0) return null;
  const net = incomeCents - spentCents;
  const scaled = Math.abs(net) * 100;
  let quotient = Math.floor(scaled / incomeCents);
  if (2 * (scaled - quotient * incomeCents) >= incomeCents) quotient += 1;
  return net < 0 ? -quotient : quotient;
}
