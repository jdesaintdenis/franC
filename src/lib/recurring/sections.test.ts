import { describe, expect, it } from "vitest";

import type { ViewItem } from "./list-view";
import { foldedCount, splitSections, type SectionItem } from "./sections";

const base: ViewItem = { id: "", name: "", status: "confirmed", typicalAmountCents: -1000, interval: "monthly", categoryId: null };
const item = (o: Partial<SectionItem>): SectionItem => ({ ...base, ...o });

const a = item({ id: "a", name: "A", typicalAmountCents: -500 });
const b = item({ id: "b", name: "B", typicalAmountCents: -9000, status: "detected" });
const c = item({ id: "c", name: "C", typicalAmountCents: -700, hasPriceAlert: true });
const d = item({ id: "d", name: "D", typicalAmountCents: -100, possiblyCancelled: true });
const pay = item({ id: "p", name: "Pay", typicalAmountCents: 250_000 });
const e1 = item({ id: "e1", status: "ended" });
const x1 = item({ id: "x1", status: "dismissed" });
const e2 = item({ id: "e2", status: "ended" });

describe("splitSections", () => {
  const all = [a, b, c, d, pay, e1, x1, e2];

  it("splits running outflows, income, ended and dismissed", () => {
    const s = splitSections(all, "next");
    expect(s.bills.map((i) => i.id)).toEqual(["c", "d", "a", "b"]);
    expect(s.income.map((i) => i.id)).toEqual(["p"]);
    expect(s.ended.map((i) => i.id)).toEqual(["e1", "e2"]);
    expect(s.dismissed.map((i) => i.id)).toEqual(["x1"]);
  });

  it("puts alerts and flags first, then the yearly order", () => {
    expect(splitSections(all, "yearly").bills.map((i) => i.id)).toEqual(["c", "d", "b", "a"]);
  });

  it("handles an empty list", () => {
    expect(splitSections([], "next")).toEqual({ bills: [], income: [], ended: [], dismissed: [] });
  });
});

describe("foldedCount", () => {
  const many = (n: number, alerts = 0) =>
    Array.from({ length: n }, (_, i) => item({ id: String(i), hasPriceAlert: i < alerts }));
  it("shows everything when it fits", () => expect(foldedCount(many(3), 4)).toBe(3));
  it("folds plain items to the limit", () => expect(foldedCount(many(10), 4)).toBe(4));
  it("never hides items that need a look", () => expect(foldedCount(many(10, 6), 4)).toBe(6));
  it("does not fold one hidden row less than the limit", () => expect(foldedCount(many(5), 4)).toBe(4));
});
