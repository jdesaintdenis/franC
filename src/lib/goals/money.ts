/** Money of one account shared by goals (Slice 55). */
export interface AccountGoalMoney {
  accountId: string;
  /** Null when the account has no balance yet. */
  balanceCents: number | null;
  /** Sum of what the account's goals hold. */
  assignedCents: number;
  /** balance − assigned; null without a balance. Negative = assigned more than the balance. */
  notAssignedCents: number | null;
}

/** Groups goal totals by account. Goals without an account are left out. */
export function goalMoneyByAccount(
  goals: readonly { accountId: string | null; savedCents: number }[],
  balances: readonly { id: string; balanceCents: number | null }[],
): Map<string, AccountGoalMoney> {
  const balanceOf = new Map(balances.map((b) => [b.id, b.balanceCents]));
  const out = new Map<string, AccountGoalMoney>();
  for (const goal of goals) {
    if (goal.accountId === null) continue;
    const assigned = (out.get(goal.accountId)?.assignedCents ?? 0) + goal.savedCents;
    const balance = balanceOf.get(goal.accountId) ?? null;
    out.set(goal.accountId, {
      accountId: goal.accountId,
      balanceCents: balance,
      assignedCents: assigned,
      notAssignedCents: balance === null ? null : balance - assigned,
    });
  }
  return out;
}

/** How much of the account's balance its goals hold, 0-100 for the gauge; 100 when over-assigned or the balance is ≤ 0. */
export function assignedPercent(money: Pick<AccountGoalMoney, "balanceCents" | "assignedCents">): number | null {
  if (money.balanceCents === null) return null;
  if (money.balanceCents <= 0 || money.assignedCents >= money.balanceCents) return 100;
  return Math.max(0, Math.floor((money.assignedCents * 100) / money.balanceCents));
}

export type AssignError = "noBalance" | "exceedsNotAssigned";

/** Whether `amountCents` (> 0) can be assigned from this account's Not assigned. */
export function canAssign(money: AccountGoalMoney | undefined, amountCents: number): AssignError | null {
  if (!money || money.notAssignedCents === null) return "noBalance";
  return money.notAssignedCents < amountCents ? "exceedsNotAssigned" : null;
}
