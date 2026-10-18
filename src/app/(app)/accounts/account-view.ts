import type { AccountStartingBalance } from "./balance-form";

/** What the accounts screen needs of one account (plain data, formatted on the server). */
export interface AccountView {
  id: string;
  name: string;
  transactionCount: number;
  importCount: number;
  /** Last import as a short day ("28 Sept"); null = never imported. */
  lastImport: string | null;
  /** Balance formatted with `formatCents`; null = no starting balance. */
  balanceLabel: string | null;
  /** Null = no starting balance set. */
  startingBalance: AccountStartingBalance | null;
  inSafeToSpend: boolean;
  importReminder: boolean;
  /** A Savings account (Slice 52): no imports or bank sync, filled by Move to savings. */
  savings: boolean;
  /** Rows franC created on it; back to a current account is refused while there are any. */
  moveCount: number;
  /** Label rules that move payments here (Savings accounts only). */
  savingsRules: {
    id: string;
    pattern: string;
    goalId: string | null;
    goalName: string | null;
  }[];
  /** Goals kept in this account, with what each holds. */
  goals: { id: string; name: string; savedCents: number }[];
  /** Balance minus what the goals hold; null without a balance or goals. */
  notAssignedCents: number | null;
  /** Bank this account is linked to through bank sync (Slice 45); null = not linked. */
  linkedBank: string | null;
  /**
   * Set when the balance comes from the bank (linked and synced): shown read-only, the amount and
   * date can't be edited. Null for a manual balance, including a linked account not synced yet.
   */
  bankBalance: {
    label: string;
    /** Null when the bank's name isn't known. */
    bankName: string | null;
    /** When franC read it, formatted in Paris time ("2 Oct 07:00"). */
    readAt: string;
    thresholdCents: number;
  } | null;
  /** Formatted sum the goals hold in this account; null when no goal holds anything. */
  assignedLabel: string | null;
  /** The import reminder is overdue (CSV accounts only). */
  stale: boolean;
  /** Linked to a bank account (so a manual balance is only a placeholder until the first sync). */
  connected: boolean;
  /** Transactions that don't add up to the bank's balances; null = none. */
  gap: { amountCents: number; from: string; to: string } | null;
}
