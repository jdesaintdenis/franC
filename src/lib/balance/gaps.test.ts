import { describe, expect, it } from "vitest";

import { findBalanceGap, type GapCheckpoint } from "./gaps";

let n = 0;
const cp = (source: "manual" | "bank", date: string, amountCents: number, acceptedGapCents = 0): GapCheckpoint => ({
  id: `c${n++}`,
  source,
  date,
  amountCents,
  acceptedGapCents,
});
const moves = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("findBalanceGap", () => {
  it("is null without a bank checkpoint", () => {
    expect(findBalanceGap([], moves({}))).toBeNull();
    expect(findBalanceGap([cp("manual", "2026-09-01", 1000)], moves({ "2026-09-02": -100 }))).toBeNull();
  });

  it("is null when franC adds up to the bank", () => {
    const cps = [cp("manual", "2026-09-01", 100000), cp("bank", "2026-09-10", 95000), cp("bank", "2026-09-20", 90000)];
    expect(findBalanceGap(cps, moves({ "2026-09-05": -5000, "2026-09-15": -5000 }))).toBeNull();
  });

  it("ignores movements on or before the baseline day", () => {
    const cps = [cp("manual", "2026-09-01", 1000), cp("bank", "2026-09-10", 900)];
    expect(findBalanceGap(cps, moves({ "2026-09-01": -9999, "2026-09-05": -100 }))).toBeNull();
  });

  it("cancels a row booked a day off between checkpoints", () => {
    const cps = [cp("manual", "2026-09-01", 1000), cp("bank", "2026-09-10", 700), cp("bank", "2026-09-11", 700)];
    // -300 is booked on the 11th in franC but the bank had it on the 10th: gap at the 10th, none after.
    expect(findBalanceGap(cps, moves({ "2026-09-11": -300 }))).toBeNull();
  });

  it("reports one gap between the last agreeing checkpoint and the first showing it", () => {
    const cps = [cp("manual", "2026-09-01", 100000), cp("bank", "2026-09-03", 99000), cp("bank", "2026-09-09", 94790)];
    const gap = findBalanceGap(cps, moves({ "2026-09-02": -1000, "2026-09-05": -1000 }));
    // The bank fell by 5210, franC only by 2000: expenses worth 3210 are missing in franC (d = -3210),
    // first visible at the 9 Sept checkpoint.
    expect(gap).toEqual({ amountCents: -3210, from: "2026-09-04", to: "2026-09-09", checkpointId: cps[2].id });
  });

  it("is negative when franC lacks expenses the bank booked", () => {
    const cps = [cp("manual", "2026-09-01", 100000), cp("bank", "2026-09-09", 90000)];
    // The bank fell by 10000, franC by 5790.
    expect(findBalanceGap(cps, moves({ "2026-09-05": -5790 }))?.amountCents).toBe(-4210);
  });

  it("keeps an old gap's dates while later checkpoints agree on it", () => {
    const cps = [
      cp("manual", "2026-09-01", 100000),
      cp("bank", "2026-09-03", 100000),
      cp("bank", "2026-09-09", 95000),
      cp("bank", "2026-10-01", 94000),
      cp("bank", "2026-10-02", 93000),
    ];
    const gap = findBalanceGap(cps, moves({ "2026-09-05": -4210, "2026-09-20": -1000, "2026-10-02": -1000 }));
    expect(gap).toEqual({ amountCents: -790, from: "2026-09-04", to: "2026-09-09", checkpointId: cps[4].id });
  });

  it("dates the gap from the last checkpoint that agreed", () => {
    const cps = [
      cp("manual", "2026-09-01", 1000),
      cp("bank", "2026-09-05", 900),
      cp("bank", "2026-09-10", 800),
      cp("bank", "2026-09-15", 700),
    ];
    const gap = findBalanceGap(cps, moves({ "2026-09-04": -100, "2026-09-08": -100 }));
    expect(gap).toMatchObject({ amountCents: -100, from: "2026-09-11", to: "2026-09-15" });
  });

  it("subtracts accepted gaps up to each checkpoint", () => {
    const base = [cp("manual", "2026-09-01", 1000), cp("bank", "2026-09-09", 600, 0)];
    expect(findBalanceGap(base, moves({ "2026-09-05": -100 }))?.amountCents).toBe(-300);
    const accepted = [base[0], cp("bank", "2026-09-09", 600, -300)];
    expect(findBalanceGap(accepted, moves({ "2026-09-05": -100 }))).toBeNull();
    // The next sync's checkpoint inherits the acceptance.
    const later = [...accepted, cp("bank", "2026-09-10", 500)];
    expect(findBalanceGap(later, moves({ "2026-09-05": -100, "2026-09-10": -100 }))).toBeNull();
  });

  it("is positive when franC holds more outflow than the bank (a duplicate) or lacks income", () => {
    const cps = [cp("manual", "2026-09-01", 1000), cp("bank", "2026-09-09", 900)];
    expect(findBalanceGap(cps, moves({ "2026-09-05": -100, "2026-09-06": -100 }))).toMatchObject({ amountCents: 100 });
  });

  it("starts at the manual starting balance, however the checkpoints are ordered", () => {
    const cps = [cp("bank", "2026-09-09", 900), cp("manual", "2026-09-01", 1000)];
    expect(findBalanceGap(cps, moves({ "2026-09-05": -50 }))).toMatchObject({
      amountCents: -50,
      from: "2026-09-02",
      to: "2026-09-09",
    });
  });

  it("starts at the first bank checkpoint when there is no manual one", () => {
    const cps = [cp("bank", "2026-09-01", 1000), cp("bank", "2026-09-09", 900)];
    expect(findBalanceGap(cps, moves({ "2026-09-05": -100 }))).toBeNull();
    expect(findBalanceGap([cps[0]], moves({}))).toBeNull();
  });
});
