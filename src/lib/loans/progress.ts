/** Share of the borrowed amount already repaid, whole percent, clamped to 0–100. */
export function repaidPercent(borrowedCents: number, owedCents: number): number {
  if (borrowedCents <= 0) return 0;
  const percent = Math.floor(((borrowedCents - owedCents) * 100) / borrowedCents);
  return Math.min(100, Math.max(0, percent));
}
