/** A Savings account with the goals kept in it, as Move to savings offers them. */
export interface SavingsAccountChoice {
  id: string;
  name: string;
  goals: { id: string; name: string; icon: string | null; savedCents: number }[];
}

export function savingsAccountChoices(
  accounts: readonly { id: string; name: string; savings: boolean }[],
  goals: readonly { id: string; name: string; icon: string | null; accountId: string | null; savedCents: number }[],
): SavingsAccountChoice[] {
  return accounts
    .filter((a) => a.savings)
    .map((a) => ({
      id: a.id,
      name: a.name,
      goals: goals.filter((g) => g.accountId === a.id).map(({ id, name, icon, savedCents }) => ({ id, name, icon, savedCents })),
    }));
}
