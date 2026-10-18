import { db } from "@/db/client";
import { refreshRecurring } from "@/db/queries/recurring";
import { applySavingsRules } from "@/db/queries/savings";
import { refreshTransfers } from "@/db/queries/transfers";

const FAILURE_MESSAGES = {
  import: {
    savings: "Savings rules failed after import change",
    transfers: "Transfer detection failed after import change",
    recurring: "Recurring detection failed after import change",
  },
  ignoreChange: {
    savings: "Savings rules failed after ignore change",
    transfers: "Transfer detection failed after ignore change",
    recurring: "Recurring detection failed after ignore change",
  },
  manualChange: {
    savings: "Savings rules failed after manual transaction change",
    transfers: "Transfer detection failed after manual transaction change",
    recurring: "Recurring detection failed after manual transaction change",
  },
  accountDelete: {
    savings: "Savings rules failed after account delete",
    transfers: "Transfer detection failed after account delete",
    recurring: "Recurring detection failed after account delete",
  },
} as const;

/**
 * Re-derives what depends on the user's transactions after an import, undo or account
 * delete has committed: internal transfers first (recurring skips paired rows), then
 * recurring items. Each step has its own transaction and can only log a fixed line:
 * a failure must neither undo nor fail the change, and the error itself may carry
 * transaction values. Returns the number of new transfer pairs and of newly raised recurring price alerts (0 on failure).
 */
export async function refreshDerivedData(
  userId: string,
  cause: keyof typeof FAILURE_MESSAGES,
): Promise<{ transfersFound: number; priceAlerts: number }> {
  let transfersFound = 0;
  let priceAlerts = 0;
  // First, so a row a savings rule moves is paired before transfer detection could pair it elsewhere.
  try {
    await applySavingsRules(db, userId);
  } catch {
    console.error(FAILURE_MESSAGES[cause].savings);
  }
  try {
    transfersFound = await refreshTransfers(db, userId);
  } catch {
    console.error(FAILURE_MESSAGES[cause].transfers);
  }
  try {
    priceAlerts = (await refreshRecurring(db, userId)).priceAlerts;
  } catch {
    console.error(FAILURE_MESSAGES[cause].recurring);
  }
  return { transfersFound, priceAlerts };
}

/**
 * Re-runs recurring detection after a transfer was linked, confirmed or unlinked
 * (paired rows are excluded from recurring). Logs a fixed line on failure: the change
 * itself already committed, and the error may carry transaction values.
 */
export async function refreshRecurringAfterTransferChange(userId: string): Promise<void> {
  try {
    await refreshRecurring(db, userId);
  } catch {
    console.error("Recurring detection failed after transfer change");
  }
}

/**
 * Re-runs recurring detection after a merchant name change committed (items are keyed by
 * merchant id and re-keyed to follow their transactions). Fixed log line on failure, like the others.
 */
export async function refreshRecurringAfterMerchantChange(userId: string): Promise<number> {
  try {
    return (await refreshRecurring(db, userId)).priceAlerts;
  } catch {
    console.error("Recurring detection failed after merchant change");
    return 0;
  }
}
