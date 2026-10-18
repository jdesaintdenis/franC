import { describe, expect, it } from "vitest";

import { checkPriceAlert, type PriceAlertItem } from "./price-alerts";
import type { RecurringTx } from "./detect";

const LABEL = "PRLV NETFLIX";
const item: PriceAlertItem = { typicalAmountCents: -1349, interval: "monthly" };

function tx(id: string, date: string, amountCents: number): RecurringTx {
  return { id, date, amountCents, labelNormalized: LABEL, merchantId: null };
}

const base = [
  tx("t1", "2025-06-05", -1349),
  tx("t2", "2025-07-05", -1349),
  tx("t3", "2025-08-05", -1349),
];

describe("checkPriceAlert", () => {
  it("raises on a price increase", () => {
    const result = checkPriceAlert(item, [...base, tx("t4", "2025-09-05", -1599)], null);
    expect(result).toEqual({
      action: "raise",
      transactionId: "t4",
      oldAmountCents: -1349,
      newAmountCents: -1599,
      chargedOn: "2025-09-05",
    });
  });

  it("ignores a small variation within tolerance", () => {
    expect(checkPriceAlert(item, [...base, tx("t4", "2025-09-05", -1449)], null)).toEqual({ action: "none" });
  });

  it("does not alert at exactly +10%", () => {
    const exact: PriceAlertItem = { typicalAmountCents: -1000, interval: "monthly" };
    const txs = [tx("a", "2025-08-05", -1000), tx("b", "2025-09-05", -1100)];
    expect(checkPriceAlert(exact, txs, null)).toEqual({ action: "none" });
    expect(checkPriceAlert(exact, [txs[0], tx("b", "2025-09-05", -1101)], null).action).toBe("raise");
  });

  it("clears an open alert when the next charge is back to normal", () => {
    const txs = [...base, tx("t4", "2025-09-05", -1599), tx("t5", "2025-10-05", -1349)];
    expect(checkPriceAlert(item, txs, { transactionId: "t4" })).toEqual({ action: "clear" });
  });

  it("updates the open alert on a newer, still higher charge", () => {
    const txs = [...base, tx("t4", "2025-09-05", -1599), tx("t5", "2025-10-05", -1699)];
    expect(checkPriceAlert(item, txs, { transactionId: "t4" })).toEqual({
      action: "update",
      transactionId: "t5",
      oldAmountCents: -1349,
      newAmountCents: -1699,
      chargedOn: "2025-10-05",
    });
  });

  it("keeps an open alert that already points at the newest charge", () => {
    const txs = [...base, tx("t4", "2025-09-05", -1599)];
    expect(checkPriceAlert(item, txs, { transactionId: "t4" })).toEqual({ action: "none" });
  });

  it("ignores a price drop", () => {
    expect(checkPriceAlert(item, [...base, tx("t4", "2025-09-05", -999)], null)).toEqual({ action: "none" });
  });

  it("ignores income items", () => {
    const salary: PriceAlertItem = { typicalAmountCents: 250000, interval: "monthly" };
    const txs = [tx("a", "2025-08-28", 250000), tx("b", "2025-09-28", 300000)];
    expect(checkPriceAlert(salary, txs, null)).toEqual({ action: "none" });
  });

  it("ignores an extra charge shortly after the previous one", () => {
    expect(checkPriceAlert(item, [...base, tx("t4", "2025-08-10", -1999)], null)).toEqual({ action: "none" });
  });

  it("needs a previous charge", () => {
    expect(checkPriceAlert(item, [tx("t1", "2025-09-05", -1999)], null)).toEqual({ action: "none" });
  });

  it("never re-raises a resolved charge", () => {
    const txs = [...base, tx("t4", "2025-09-05", -1599)];
    expect(checkPriceAlert(item, txs, null, new Set(["t4"]))).toEqual({ action: "none" });
    expect(checkPriceAlert(item, txs, { transactionId: "t3" }, new Set(["t4"]))).toEqual({ action: "clear" });
  });
});
