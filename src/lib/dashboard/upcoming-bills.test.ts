import { describe, expect, it } from "vitest";

import type { SafeToSpendBill } from "../safe-to-spend/compute";
import { BIG_BILL_CENTS, billsNear, buildUpcomingBills, dotSize, isBigBill } from "./upcoming-bills";

function bill(name: string, date: string, euros: number, id = name): SafeToSpendBill {
  return { id, name, date, amountCents: -Math.round(euros * 100), status: "confirmed", categoryId: null, accountId: "a", tracked: false };
}

const TODAY = "2026-10-15";

describe("buildUpcomingBills", () => {
  it("totals the bills and counts the big ones; exactly 100,00 € is big, 99,99 € is not", () => {
    const u = buildUpcomingBills([bill("A", "2026-10-20", 100), bill("B", "2026-10-21", 99.99), bill("C", "2026-10-22", 250)], TODAY);
    expect(u.totalCents).toBe(44_999);
    expect(u.count).toBe(3);
    expect(u.bigCount).toBe(2);
    expect(isBigBill(bill("x", TODAY, BIG_BILL_CENTS / 100))).toBe(true);
    expect(isBigBill(bill("x", TODAY, 99.99))).toBe(false);
  });

  it("lists the biggest three, largest first, ties by date then name", () => {
    const u = buildUpcomingBills(
      [bill("Small", "2026-10-16", 5), bill("Tie B", "2026-10-25", 50), bill("Tie A", "2026-10-25", 50), bill("Early", "2026-10-18", 50), bill("Big", "2026-10-30", 300)],
      TODAY,
    );
    expect(u.biggest.map((b) => b.name)).toEqual(["Big", "Early", "Tie A"]);
  });

  it("merges the bills of one date into a single dot, big if any of them is", () => {
    const u = buildUpcomingBills([bill("A", "2026-10-20", 20), bill("B", "2026-10-20", 120), bill("C", "2026-10-22", 10)], TODAY);
    expect(u.dots).toHaveLength(2);
    expect(u.dots[0]).toMatchObject({ date: "2026-10-20", totalCents: 14_000, big: true });
    expect(u.dots[0].bills.map((b) => b.name)).toEqual(["A", "B"]);
    expect(u.dots[1].big).toBe(false);
  });

  it("places day 1 at 0 and the last day at 1, and clamps a bill dated before the month to day 1", () => {
    const u = buildUpcomingBills([bill("Old", "2026-09-30", 10), bill("Last", "2026-10-31", 10)], TODAY);
    expect(u.dots.map((d) => [d.date, d.position])).toEqual([["2026-10-01", 0], ["2026-10-31", 1]]);
    // The row keeps the bill's real date.
    expect(u.dots[0].bills[0].date).toBe("2026-09-30");
  });

  it("puts today at 14/30 on the strip of a 31-day month (day 15)", () => {
    expect(buildUpcomingBills([], TODAY).todayPosition).toBeCloseTo(14 / 30);
  });

  it("is empty without bills", () => {
    expect(buildUpcomingBills([], TODAY)).toMatchObject({ count: 0, bigCount: 0, dots: [], biggest: [], totalCents: 0 });
  });
});

describe("dotSize", () => {
  it("runs from 8 to 22 px, capped at 300 €, and never shrinks as the amount grows", () => {
    expect(dotSize(0)).toBe(8);
    expect(dotSize(30_000)).toBe(22);
    expect(dotSize(90_000)).toBe(22);
    expect(dotSize(5_000)).toBeLessThanOrEqual(dotSize(10_000));
  });
});

describe("billsNear", () => {
  it("returns the bills of the day before, the day itself and the day after, in date order", () => {
    const u = buildUpcomingBills(
      [bill("Before", "2026-10-19", 10), bill("Same", "2026-10-20", 10), bill("After", "2026-10-21", 10), bill("Far", "2026-10-23", 10), bill("Gone", "2026-10-17", 10)],
      TODAY,
    );
    expect(billsNear(u.dots, "2026-10-20").map((b) => b.name)).toEqual(["Before", "Same", "After"]);
  });
});
