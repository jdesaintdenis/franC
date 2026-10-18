import { describe, expect, it } from "vitest";

import {
  detectRecurring,
  groupKey,
  groupTransactions,
  type RecurringTx,
} from "./detect";

let seq = 0;
function tx(
  date: string,
  amountCents: number,
  labelNormalized: string | null,
  merchantId: string | null = null,
): RecurringTx {
  seq += 1;
  return {
    id: `tx-${String(seq).padStart(3, "0")}`,
    date,
    amountCents,
    labelNormalized,
    merchantId,
  };
}

const ORANGE = "PRLV ORANGE BOX";
const NETFLIX = "CB NETFLIX.COM FACT 050925";
const SALARY = "VIR SEPA ATELIER LUMEN SAS";

function monthly(label: string, cents: number, dates: string[]): RecurringTx[] {
  return dates.map((d) => tx(d, cents, label));
}

describe("detectRecurring: intervals", () => {
  it("detects a monthly payment with a typical amount and next date", () => {
    const txs = monthly(ORANGE, -6650, [
      "2025-07-29",
      "2025-08-29",
      "2025-09-29",
    ]);
    const [c] = detectRecurring(txs, "2025-09-29");
    expect(c).toEqual({
      merchantKey: "ORANGE BOX",
      sign: "out",
      interval: "monthly",
      typicalAmountCents: -6650,
      lastSeenDate: "2025-09-29",
      nextExpectedDate: "2025-10-29",
      transactionIds: txs.map((t) => t.id),
    });
  });

  it("tolerates booking-date slip within the monthly band", () => {
    const txs = monthly(ORANGE, -6650, [
      "2025-07-28",
      "2025-08-30",
      "2025-09-29",
    ]);
    expect(detectRecurring(txs, "2025-09-30")).toHaveLength(1);
  });

  it("clamps next expected date from the 31st into February", () => {
    const txs = monthly("PRLV EDF", -9000, [
      "2024-11-30",
      "2024-12-31",
      "2025-01-31",
    ]);
    const [c] = detectRecurring(txs, "2025-01-31");
    expect(c.nextExpectedDate).toBe("2025-02-28");
  });

  it("clamps into a leap-year February", () => {
    const txs = monthly("PRLV EDF", -9000, [
      "2023-11-30",
      "2023-12-31",
      "2024-01-31",
    ]);
    const [c] = detectRecurring(txs, "2024-01-31");
    expect(c.nextExpectedDate).toBe("2024-02-29");
  });

  it("detects a weekly payment", () => {
    const txs = monthly("CB CLUB FORME PLUS FACT 010925", -1500, [
      "2025-09-01",
      "2025-09-08",
      "2025-09-15",
      "2025-09-22",
    ]);
    const [c] = detectRecurring(txs, "2025-09-22");
    expect(c.interval).toBe("weekly");
    expect(c.nextExpectedDate).toBe("2025-09-29");
    expect(c.transactionIds).toHaveLength(4);
  });

  it("detects a quarterly payment", () => {
    const txs = monthly("PRLV REGIE DES EAUX DU VAL", -4200, [
      "2025-01-10",
      "2025-04-10",
      "2025-07-10",
    ]);
    const [c] = detectRecurring(txs, "2025-07-10");
    expect(c.interval).toBe("quarterly");
    expect(c.nextExpectedDate).toBe("2025-10-10");
  });

  it("detects a yearly payment", () => {
    const txs = monthly("PRLV ASSURANCE LOGIS", -30000, [
      "2022-03-15",
      "2023-03-15",
      "2024-03-14",
      "2025-03-15",
    ]);
    const [c] = detectRecurring(txs, "2025-06-01");
    expect(c.interval).toBe("yearly");
    expect(c.nextExpectedDate).toBe("2026-03-15");
  });

  it("spans a leap year in the yearly band", () => {
    const txs = monthly("PRLV ASSURANCE LOGIS", -30000, [
      "2023-03-01",
      "2024-03-01",
      "2025-03-01",
    ]);
    // 366 days between the first two: still inside 355-375.
    expect(detectRecurring(txs, "2025-03-01")[0].interval).toBe("yearly");
  });

  it("groups card payments whose dates differ in the label", () => {
    const txs = [
      tx("2025-07-05", -1399, "CB NETFLIX.COM FACT 050725"),
      tx("2025-08-05", -1399, "CB NETFLIX.COM FACT 050825"),
      tx("2025-09-05", -1399, NETFLIX),
    ];
    const [c] = detectRecurring(txs, "2025-09-05");
    expect(c.merchantKey).toBe("NETFLIX.COM");
  });
});

describe("detectRecurring: not recurring", () => {
  it("rejects irregular gaps", () => {
    const txs = monthly(ORANGE, -6650, [
      "2025-06-02",
      "2025-07-20",
      "2025-09-29",
    ]);
    expect(detectRecurring(txs, "2025-09-29")).toEqual([]);
  });

  it("rejects fewer than 3 occurrences", () => {
    const txs = monthly(ORANGE, -6650, ["2025-08-29", "2025-09-29"]);
    expect(detectRecurring(txs, "2025-09-29")).toEqual([]);
  });

  it("rejects unstable amounts", () => {
    const txs = [
      tx("2025-07-29", -2000, ORANGE),
      tx("2025-08-29", -6650, ORANGE),
      tx("2025-09-29", -1000, ORANGE),
    ];
    expect(detectRecurring(txs, "2025-09-29")).toEqual([]);
  });

  it("rejects groups with two payments on the same day", () => {
    const txs = [
      ...monthly(ORANGE, -6650, ["2025-07-29", "2025-08-29", "2025-09-29"]),
      tx("2025-09-29", -6650, ORANGE),
    ];
    expect(detectRecurring(txs, "2025-09-29")).toEqual([]);
  });

  it("skips null, empty labels and zero amounts", () => {
    const txs = [
      ...monthly("", -500, ["2025-07-01", "2025-08-01", "2025-09-01"]),
      ...["2025-07-01", "2025-08-01", "2025-09-01"].map((d) =>
        tx(d, -500, null),
      ),
      ...monthly(ORANGE, 0, ["2025-07-01", "2025-08-01", "2025-09-01"]),
    ];
    expect(detectRecurring(txs, "2025-09-01")).toEqual([]);
  });

  it("accepts the band edges only", () => {
    const count = (label: string, dates: string[], ref: string) =>
      detectRecurring(monthly(label, -100, dates), ref).length;
    // Gaps of 26 (out), 27 (in), 33 (in) and 34 (out) days.
    expect(
      count("A", ["2025-01-01", "2025-01-27", "2025-02-22"], "2025-02-22"),
    ).toBe(0);
    expect(
      count("A", ["2025-01-01", "2025-01-28", "2025-02-24"], "2025-02-24"),
    ).toBe(1);
    expect(
      count("B", ["2025-01-01", "2025-02-03", "2025-03-08"], "2025-03-08"),
    ).toBe(1);
    expect(
      count("B", ["2025-01-01", "2025-02-04", "2025-03-10"], "2025-03-10"),
    ).toBe(0);
  });
});

describe("detectRecurring: trailing run", () => {
  it("excludes the old price and detects the new one after 3 occurrences", () => {
    const old = monthly(ORANGE, -3000, ["2025-03-29", "2025-04-29"]);
    const fresh = monthly(ORANGE, -4000, [
      "2025-05-29",
      "2025-06-29",
      "2025-07-29",
    ]);
    const [c] = detectRecurring([...old, ...fresh], "2025-07-29");
    expect(c.typicalAmountCents).toBe(-4000);
    expect(c.transactionIds).toEqual(fresh.map((t) => t.id));
  });

  it("does not detect right after a price change", () => {
    const txs = [
      ...monthly(ORANGE, -3000, ["2025-05-29", "2025-06-29"]),
      ...monthly(ORANGE, -4000, ["2025-07-29"]),
    ];
    expect(detectRecurring(txs, "2025-07-29")).toEqual([]);
  });

  it("ignores an old missed month", () => {
    const txs = monthly(ORANGE, -6650, [
      "2025-01-29",
      "2025-03-29", // February missed
      "2025-04-29",
      "2025-05-29",
      "2025-06-29",
    ]);
    const [c] = detectRecurring(txs, "2025-06-29");
    expect(c.transactionIds).toEqual(txs.slice(1).map((t) => t.id));
  });

  it("uses the median of the run, lower-middle for even counts", () => {
    const txs = [
      tx("2025-06-01", -1000, "X"),
      tx("2025-07-01", -1040, "X"),
      tx("2025-08-01", -1020, "X"),
      tx("2025-09-01", -1030, "X"),
    ];
    // Sorted signed: -1040, -1030, -1020, -1000 -> lower-middle -1030.
    expect(detectRecurring(txs, "2025-09-01")[0].typicalAmountCents).toBe(
      -1030,
    );
  });
});

describe("detectRecurring: inflows and signs", () => {
  it("detects a salary as an inflow", () => {
    const txs = monthly(SALARY, 289640, [
      "2025-07-28",
      "2025-08-28",
      "2025-09-29",
    ]);
    const [c] = detectRecurring(txs, "2025-09-29");
    expect(c.sign).toBe("in");
    expect(c.merchantKey).toBe("ATELIER LUMEN SAS");
    expect(c.typicalAmountCents).toBe(289640);
  });

  it("keeps the sign with more occurrences when both qualify", () => {
    const outs = monthly("PRLV FOO", -1000, [
      "2025-06-05",
      "2025-07-05",
      "2025-08-05",
      "2025-09-05",
    ]);
    const ins = monthly("PRLV FOO", 500, [
      "2025-07-06",
      "2025-08-06",
      "2025-09-06",
    ]);
    const result = detectRecurring([...outs, ...ins], "2025-09-06");
    expect(result).toHaveLength(1);
    expect(result[0].sign).toBe("out");
  });

  it("breaks a count tie by recency, then prefers out", () => {
    const outs = monthly("PRLV FOO", -1000, [
      "2025-07-05",
      "2025-08-05",
      "2025-09-05",
    ]);
    const ins = monthly("PRLV FOO", 500, [
      "2025-07-06",
      "2025-08-06",
      "2025-09-06",
    ]);
    expect(detectRecurring([...outs, ...ins], "2025-09-06")[0].sign).toBe("in");

    const ins2 = monthly("PRLV BAR", 500, [
      "2025-07-05",
      "2025-08-05",
      "2025-09-05",
    ]);
    const outs2 = monthly("PRLV BAR", -1000, [
      "2025-07-05",
      "2025-08-05",
      "2025-09-05",
    ]);
    expect(detectRecurring([...ins2, ...outs2], "2025-09-05")[0].sign).toBe(
      "out",
    );
  });
});

describe("detectRecurring: staleness", () => {
  const txs = () =>
    monthly(ORANGE, -6650, ["2025-01-29", "2025-02-28", "2025-03-29"]);

  it("keeps a payment while less than two intervals are missed", () => {
    // Next expected 2025-04-29, then 2025-05-29.
    expect(detectRecurring(txs(), "2025-05-29")).toHaveLength(1);
  });

  it("drops a payment once two intervals have passed", () => {
    expect(detectRecurring(txs(), "2025-05-30")).toEqual([]);
  });
});

describe("detectRecurring: output", () => {
  it("is sorted by merchant key regardless of input order", () => {
    const a = monthly("PRLV ZED", -100, [
      "2025-07-01",
      "2025-08-01",
      "2025-09-01",
    ]);
    const b = monthly("PRLV ALPHA", -100, [
      "2025-07-02",
      "2025-08-02",
      "2025-09-02",
    ]);
    const result = detectRecurring([...a, ...b], "2025-09-02");
    expect(result.map((c) => c.merchantKey)).toEqual(["ALPHA", "ZED"]);
  });
});

describe("groupTransactions", () => {
  it("keys groups by sign and merchant key and tracks the newest date", () => {
    const txs = [
      tx("2025-09-05", -1399, NETFLIX),
      tx("2025-08-05", -1399, "CB NETFLIX.COM FACT 050825"),
      tx("2025-08-06", 1399, "CB NETFLIX.COM FACT 060825"),
      tx("2025-08-06", -100, null),
    ];
    const groups = groupTransactions(txs);
    expect([...groups.keys()].sort()).toEqual([
      groupKey("NETFLIX.COM", "in"),
      groupKey("NETFLIX.COM", "out"),
    ]);
    const out = groups.get(groupKey("NETFLIX.COM", "out"));
    expect(out?.lastSeenDate).toBe("2025-09-05");
    expect(out?.txs.map((t) => t.date)).toEqual(["2025-08-05", "2025-09-05"]);
  });
});

describe("detectRecurring: merchant names", () => {
  const dates = ["2025-07-11", "2025-08-11", "2025-09-11"];

  it("groups two label variants of one merchant into one item keyed by the merchant id", () => {
    const txs = [
      tx(dates[0], -4210, "CB INTERMARCHE FACT 110725", "m1"),
      tx(dates[1], -4210, "CB INTERMAR CENTRE FACT 110825", "m1"),
      tx(dates[2], -4210, "CB INTERMARCHE FACT 110925", "m1"),
    ];
    const found = detectRecurring(txs, "2025-09-11");
    expect(found).toHaveLength(1);
    expect(found[0].merchantKey).toBe("merchant:m1");
    expect(found[0].transactionIds).toHaveLength(3);
  });

  it("does not group the variants without a merchant", () => {
    const txs = [
      tx(dates[0], -4210, "CB INTERMARCHE FACT 110725"),
      tx(dates[1], -4210, "CB INTERMAR CENTRE FACT 110825"),
      tx(dates[2], -4210, "CB INTERMARCHE FACT 110925"),
    ];
    expect(detectRecurring(txs, "2025-09-11")).toEqual([]);
  });

  it("groups rows that have a merchant but no label", () => {
    const txs = dates.map((d) => tx(d, -999, null, "m2"));
    expect(detectRecurring(txs, "2025-09-11").map((c) => c.merchantKey)).toEqual(["merchant:m2"]);
  });

  it("keeps unnamed rows on their label key", () => {
    const [c] = detectRecurring(monthly(ORANGE, -6650, dates), "2025-09-11");
    expect(c.merchantKey).toBe("ORANGE BOX");
  });
});
