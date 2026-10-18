import { daysBetween, type RecurringInterval } from "./dates";
import { INTERVAL_BANDS, type RecurringTx } from "./detect";

export interface PriceAlertItem {
  /** Signed usual amount, as stored on the recurring item. */
  typicalAmountCents: number;
  interval: RecurringInterval;
}

export interface OpenPriceAlert {
  transactionId: string;
}

export interface PriceAlertCharge {
  transactionId: string;
  oldAmountCents: number;
  newAmountCents: number;
  chargedOn: string;
}

export type PriceAlertCheck =
  | { action: "none" }
  | ({ action: "raise" } & PriceAlertCharge)
  | ({ action: "update" } & PriceAlertCharge)
  | { action: "clear" };

const NONE: PriceAlertCheck = { action: "none" };

// Integer check for "more than 10% above the usual outflow" (amounts are negative).
function isPriceIncrease(chargeCents: number, usualCents: number): boolean {
  const charge = Math.abs(chargeCents);
  const usual = Math.abs(usualCents);
  return charge > usual && (charge - usual) * 10 > usual;
}

/**
 * Decides what to do with an item's price alert, given the merchant group's
 * transactions and the item's open alert (if any).
 *
 * Only outflows are checked. The newest charge alerts when it is more than 10% above
 * the usual amount and arrives at least the interval's minimum gap after the previous
 * charge, so an extra purchase mid-period is not read as a new price. Charges in
 * `resolvedTransactionIds` (accepted or dismissed) are never raised again.
 */
export function checkPriceAlert(
  item: PriceAlertItem,
  groupTxs: readonly RecurringTx[],
  openAlert: OpenPriceAlert | null,
  resolvedTransactionIds: ReadonlySet<string> = new Set(),
): PriceAlertCheck {
  if (item.typicalAmountCents >= 0 || groupTxs.length === 0) return NONE;

  const sorted = [...groupTxs].sort((a, b) =>
    a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date),
  );
  const latest = sorted[sorted.length - 1];
  const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;

  if (resolvedTransactionIds.has(latest.id)) {
    return openAlert ? { action: "clear" } : NONE;
  }
  if (openAlert?.transactionId === latest.id) return NONE;

  // An extra charge mid-period says nothing about the price: leave the state as it is.
  const spacedLikeARenewal =
    previous !== null &&
    daysBetween(previous.date, latest.date) >= INTERVAL_BANDS[item.interval].min;
  if (!spacedLikeARenewal) return NONE;

  if (!isPriceIncrease(latest.amountCents, item.typicalAmountCents)) {
    return openAlert ? { action: "clear" } : NONE;
  }

  const charge: PriceAlertCharge = {
    transactionId: latest.id,
    oldAmountCents: item.typicalAmountCents,
    newAmountCents: latest.amountCents,
    chargedOn: latest.date,
  };
  return openAlert ? { action: "update", ...charge } : { action: "raise", ...charge };
}
