import { currentDate } from "../dashboard/month";
import { parseFrDate } from "../import/date";
import { bankAmountToCents } from "./amount";
import type { BankBalance } from "./schemas";

/** The bank's booked balance as a checkpoint: `amountCents` at the end of `date`. */
export type PickedBalance = { date: string; amountCents: number; balanceType: string };

// Booked balances only. XPCD (expected) and ITAV (available) include pending card payments, which
// franC doesn't import, so they would never add up. Closing booked first, then interim, then other.
const PREFERENCE = ["CLBD", "ITBD", "OTHR"] as const;
const MAX_ABS_CENTS = 1_000_000_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoDate(value: string | null | undefined): string | null {
  const match = ISO_DATE.exec((value ?? "").trim());
  return match ? parseFrDate(`${match[3]}/${match[2]}/${match[1]}`) : null;
}

function balanceDate(balance: BankBalance, now: Date): string {
  const reference = isoDate(balance.reference_date);
  if (reference) return reference;
  const changed = balance.last_change_date_time ? new Date(balance.last_change_date_time) : null;
  if (changed && !Number.isNaN(changed.getTime())) return currentDate(changed);
  return currentDate(now);
}

/** Balance amounts are signed decimals, or unsigned (then positive). Null when malformed. */
function balanceCents(amount: string): number | null {
  const trimmed = amount.trim();
  const signed = trimmed.startsWith("-") || trimmed.startsWith("+");
  const cents = bankAmountToCents(trimmed, signed ? null : "CRDT");
  return cents !== null && Math.abs(cents) <= MAX_ABS_CENTS ? cents : null;
}

/** The balance to store, or null when the bank sent nothing usable (non-EUR, only pending types, malformed). */
export function pickBookedBalance(balances: readonly BankBalance[], now: Date): PickedBalance | null {
  for (const type of PREFERENCE) {
    let best: PickedBalance | null = null;
    for (const balance of balances) {
      if (balance.balance_type !== type || balance.balance_amount.currency !== "EUR") continue;
      const amountCents = balanceCents(balance.balance_amount.amount);
      if (amountCents === null) continue;
      const date = balanceDate(balance, now);
      if (best === null || date > best.date) best = { date, amountCents, balanceType: type };
    }
    if (best) return best;
  }
  return null;
}
