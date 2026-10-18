import { describe, expect, it } from "vitest";

import { monthBalanceCurve, sumCurves } from "./month-curve";

const net = (rows: Record<string, number>) => new Map(Object.entries(rows));

describe("monthBalanceCurve", () => {
  it("rebuilds a past month backwards from a later balance", () => {
    // Balance 1000 at 2026-08-03. Rows: 07-30 -50, 08-02 +20 (past, after month end), 07-31 none.
    const curve = monthBalanceCurve({
      balanceCents: 1000,
      asOf: "2026-08-03",
      dailyNet: net({ "2026-07-30": -50, "2026-08-02": 20, "2026-07-01": -10 }),
      projection: [],
      spreadCents: 0,
      monthStart: "2026-07-01",
      monthEnd: "2026-07-31",
    });
    expect(curve).toHaveLength(31);
    expect(curve[30]).toEqual({ date: "2026-07-31", balanceCents: 980, projected: false });
    expect(curve[29]).toEqual({ date: "2026-07-30", balanceCents: 980, projected: false });
    expect(curve[28]).toEqual({ date: "2026-07-29", balanceCents: 1030, projected: false });
    expect(curve[0]).toEqual({ date: "2026-07-01", balanceCents: 1030, projected: false });
  });

  it("current month: real up to asOf, then the projection", () => {
    const curve = monthBalanceCurve({
      balanceCents: 500,
      asOf: "2026-10-02",
      dailyNet: net({ "2026-10-01": -100, "2026-10-02": -50 }),
      projection: [
        { date: "2026-10-03", balanceCents: 500 },
        { date: "2026-10-04", balanceCents: 300 },
        { date: "2026-10-05", balanceCents: 300 },
      ],
      spreadCents: 0,
      monthStart: "2026-10-01",
      monthEnd: "2026-10-05",
    });
    expect(curve.map((p) => [p.date.slice(8), p.balanceCents, p.projected])).toEqual([
      ["01", 550, false],
      ["02", 500, false],
      ["03", 500, true],
      ["04", 300, true],
      ["05", 300, true],
    ]);
  });

  it("subtracts the spread budget evenly, remainder on the last day", () => {
    const curve = monthBalanceCurve({
      balanceCents: 1000,
      asOf: "2026-10-01",
      dailyNet: net({}),
      projection: [
        { date: "2026-10-02", balanceCents: 1000 },
        { date: "2026-10-03", balanceCents: 1000 },
        { date: "2026-10-04", balanceCents: 1000 },
      ],
      spreadCents: 100,
      monthStart: "2026-10-01",
      monthEnd: "2026-10-04",
    });
    expect(curve.slice(1).map((p) => p.balanceCents)).toEqual([967, 934, 900]);
  });

  it("carries a missing projection day and drops days past the projection's end", () => {
    const curve = monthBalanceCurve({
      balanceCents: 100,
      asOf: "2026-10-01",
      dailyNet: net({}),
      projection: [{ date: "2026-10-02", balanceCents: 80 }],
      spreadCents: 0,
      monthStart: "2026-10-01",
      monthEnd: "2026-10-05",
    });
    expect(curve.map((p) => p.date.slice(8))).toEqual(["01", "02"]);
  });

  it("is flat when nothing moved", () => {
    const curve = monthBalanceCurve({
      balanceCents: 700,
      asOf: "2026-07-31",
      dailyNet: net({}),
      projection: [],
      spreadCents: 0,
      monthStart: "2026-07-01",
      monthEnd: "2026-07-31",
    });
    expect(new Set(curve.map((p) => p.balanceCents))).toEqual(new Set([700]));
  });
});

describe("sumCurves", () => {
  it("adds accounts day by day and carries each last value", () => {
    const a = [
      { date: "2026-07-01", balanceCents: 100, projected: false },
      { date: "2026-07-02", balanceCents: 90, projected: false },
    ];
    const b = [{ date: "2026-07-02", balanceCents: 10, projected: true }];
    expect(sumCurves([a, b])).toEqual([
      { date: "2026-07-01", balanceCents: 110, projected: false },
      { date: "2026-07-02", balanceCents: 100, projected: true },
    ]);
  });
});
