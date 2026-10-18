export interface AccountTotals {
  /** Null when no account has a balance. */
  totalCents: number | null;
  currentCents: number;
  savingsCents: number;
  hasCurrent: boolean;
  hasSavings: boolean;
}

/** What is on the user's accounts: all balances added up, and split between current and savings accounts. Integer cents. */
export function accountTotals(accounts: ReadonlyArray<{ balanceCents: number | null; savings: boolean }>): AccountTotals {
  let currentCents = 0;
  let savingsCents = 0;
  let hasCurrent = false;
  let hasSavings = false;
  for (const { balanceCents, savings } of accounts) {
    if (balanceCents === null) continue;
    if (savings) {
      savingsCents += balanceCents;
      hasSavings = true;
    } else {
      currentCents += balanceCents;
      hasCurrent = true;
    }
  }
  return {
    totalCents: hasCurrent || hasSavings ? currentCents + savingsCents : null,
    currentCents,
    savingsCents,
    hasCurrent,
    hasSavings,
  };
}
