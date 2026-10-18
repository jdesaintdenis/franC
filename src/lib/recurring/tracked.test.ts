import { describe, expect, it } from "vitest";

import { recentRange, trackedFields } from "./tracked";

const tx = (date: string, amountCents: number) => ({ date, amountCents });

describe("trackedFields", () => {
  it("uses the lower median of the newest 6 only", () => {
    const txs = [
      tx("2026-01-01", 999_999), // older outlier, ignored
      tx("2026-02-01", 240_000),
      tx("2026-03-01", 330_000),
      tx("2026-04-01", 285_000),
      tx("2026-05-01", 250_000),
      tx("2026-06-01", 300_000),
      tx("2026-07-01", 270_000),
    ];
    // sorted last 6: 240, 250, 270, 285, 300, 330 -> lower middle 270
    expect(trackedFields(txs, "monthly").typicalAmountCents).toBe(270_000);
  });

  it("takes the lower middle for an even count", () => {
    const txs = [tx("2026-01-01", 100), tx("2026-02-01", 400), tx("2026-03-01", 200), tx("2026-04-01", 300)];
    expect(trackedFields(txs, "monthly").typicalAmountCents).toBe(200);
  });

  it("reads the cadence from the median gap", () => {
    const monthly = [tx("2026-01-01", 1), tx("2026-01-31", 1), tx("2026-03-02", 1)];
    expect(trackedFields(monthly, "weekly").interval).toBe("monthly");
    const weekly = [tx("2026-01-01", 1), tx("2026-01-08", 1), tx("2026-01-15", 1)];
    expect(trackedFields(weekly, "monthly").interval).toBe("weekly");
  });

  it("falls back for one payment or a gap in no band", () => {
    expect(trackedFields([tx("2026-01-01", 5)], "quarterly").interval).toBe("quarterly");
    expect(trackedFields([tx("2026-01-01", 5), tx("2026-02-20", 5)], "quarterly").interval).toBe("quarterly");
  });

  it("projects the next date from the last payment, clamped to month end", () => {
    const fields = trackedFields([tx("2026-01-01", 1), tx("2026-01-31", 1)], "monthly");
    expect(fields.lastSeenDate).toBe("2026-01-31");
    expect(fields.nextExpectedDate).toBe("2026-02-28");
  });
});

describe("recentRange", () => {
  it("covers the newest 6 amounts", () => {
    const history = [10, 20, 30, 40, 50, 60, 1_000].map((amountCents) => ({ amountCents }));
    expect(recentRange(history)).toEqual({ min: 10, max: 60 });
  });

  it("handles outflows and empty history", () => {
    expect(recentRange([{ amountCents: -300 }, { amountCents: -100 }])).toEqual({ min: -300, max: -100 });
    expect(recentRange([])).toBeNull();
  });
});
