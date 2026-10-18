import { describe, expect, it } from "vitest";

import type { BudgetRow } from "../budgets/progress";
import type { ForecastItem } from "../recurring/forecast";
import { buildSafeToSpend, type SafeToSpendAccount } from "./compute";

const HOUSING = "cat-housing";
const INTERNET = "cat-internet";
const FOOD = "cat-food";
const LEISURE = "cat-leisure";

const PARENTS = new Map<string, string | null>([
  [HOUSING, null],
  [INTERNET, HOUSING],
  [FOOD, null],
  [LEISURE, null],
]);

const account = (over: Partial<SafeToSpendAccount> = {}): SafeToSpendAccount => ({
  accountId: "a1",
  name: "Checking",
  balanceCents: 200000,
  asOf: "2026-09-14",
  inSafeToSpend: true,
  ...over,
});

const item = (over: Partial<ForecastItem> & { id: string }): ForecastItem => ({
  accountId: "a1",
  name: "ORANGE",
  merchantKey: "ORANGE",
  amountCents: -6650,
  interval: "monthly",
  status: "confirmed",
  lastSeenDate: "2026-08-29",
  categoryId: null,
  ...over,
});

const budget = (over: Partial<BudgetRow> & { categoryId: string }): BudgetRow => ({
  name: over.categoryId,
  color: "#000000",
  parentId: null,
  parentName: null,
  budgetCents: 0,
  spentCents: 0,
  ...over,
});

function run(over: {
  accounts?: SafeToSpendAccount[];
  items?: ForecastItem[];
  budgetRows?: BudgetRow[];
  today?: string;
}) {
  return buildSafeToSpend({
    accounts: over.accounts ?? [account()],
    items: over.items ?? [],
    budgetRows: over.budgetRows ?? [],
    parentOf: PARENTS,
    today: over.today ?? "2026-09-14",
  });
}

const orange = item({ id: "orange", lastSeenDate: "2026-08-29" }); // due 2026-09-29
const edf = item({ id: "edf", name: "EDF", merchantKey: "EDF", amountCents: -8900, lastSeenDate: "2026-08-25" }); // 09-25
const salary = item({
  id: "salary",
  name: "VIR SEPA ATELIER LUMEN",
  merchantKey: "ATELIER LUMEN",
  amountCents: 250000,
  lastSeenDate: "2026-08-28",
}); // 09-28

describe("buildSafeToSpend", () => {
  it("mid-month: balance minus bills minus budgets left", () => {
    const r = run({
      items: [orange, edf],
      budgetRows: [budget({ categoryId: FOOD, budgetCents: 40000, spentCents: 15000 })],
    });
    expect(r.monthEnd).toBe("2026-09-30");
    expect(r.asOf).toBe("2026-09-14");
    expect(r.balanceCents).toBe(200000);
    expect(r.billsCents).toBe(6650 + 8900);
    expect(r.bills.map((b) => b.id)).toEqual(["edf", "orange"]);
    expect(r.budgetsLeftCents).toBe(25000);
    expect(r.safeCents).toBe(200000 - 15550 - 25000);
  });

  it("reserves the rolled-over amount too, and less after overspending (Slice 29)", () => {
    const saved = run({ budgetRows: [budget({ categoryId: FOOD, budgetCents: 5000, spentCents: 1000, carryCents: 20000 })] });
    expect(saved.budgetsLeftCents).toBe(24000);
    const short = run({ budgetRows: [budget({ categoryId: FOOD, budgetCents: 5000, spentCents: 1000, carryCents: -4500 })] });
    expect(short.budgetsLeftCents).toBe(0);
  });

  it("does not count a bill already paid this month", () => {
    const paid = item({ id: "orange", lastSeenDate: "2026-09-03" });
    const r = run({ items: [paid] });
    expect(r.bills).toEqual([]);
    expect(r.safeCents).toBe(200000);
  });

  it("reserves nothing for an over-budget category and the remainder for an under-budget one", () => {
    const r = run({
      budgetRows: [
        budget({ categoryId: FOOD, budgetCents: 40000, spentCents: 52000 }),
        budget({ categoryId: LEISURE, budgetCents: 10000, spentCents: 2500 }),
      ],
    });
    const byId = new Map(r.budgets.map((b) => [b.categoryId, b.reservedCents]));
    expect(byId.get(FOOD)).toBe(0);
    expect(byId.get(LEISURE)).toBe(7500);
    expect(r.budgetsLeftCents).toBe(7500);
  });

  it("reserves 0 without budgets", () => {
    const r = run({});
    expect(r.budgets).toEqual([]);
    expect(r.budgetsLeftCents).toBe(0);
  });

  it("counts a bill inside a budgeted category once", () => {
    const rent = item({ id: "rent", name: "LOYER", amountCents: -85000, categoryId: HOUSING, lastSeenDate: "2026-08-05" });
    const late = item({ ...rent, lastSeenDate: "2026-08-20" }); // due 09-20
    const r = run({ items: [late], budgetRows: [budget({ categoryId: HOUSING, budgetCents: 85000 })] });
    expect(r.billsCents).toBe(85000);
    expect(r.budgets[0].billsCents).toBe(85000);
    expect(r.budgetsLeftCents).toBe(0);
    expect(r.safeCents).toBe(200000 - 85000);
  });

  it("reserves 0, not a negative amount, when the bill exceeds the budget remainder", () => {
    const edfBig = item({ ...edf, categoryId: HOUSING, amountCents: -30000 });
    const r = run({
      items: [edfBig],
      budgetRows: [budget({ categoryId: HOUSING, budgetCents: 40000, spentCents: 20000 })],
    });
    expect(r.budgets[0].reservedCents).toBe(0);
    expect(r.safeCents).toBe(200000 - 30000);
  });

  it("takes a subcategory bill out of its budgeted parent", () => {
    const internet = item({ ...orange, categoryId: INTERNET });
    const r = run({
      items: [internet],
      budgetRows: [
        budget({ categoryId: HOUSING, budgetCents: 30000, spentCents: 10000 }),
        budget({ categoryId: INTERNET, parentId: HOUSING, parentName: "Housing", budgetCents: 5000, spentCents: 0 }),
      ],
    });
    expect(r.budgets).toHaveLength(1);
    expect(r.budgets[0].categoryId).toBe(HOUSING);
    expect(r.budgets[0].reservedCents).toBe(30000 - 10000 - 6650);
  });

  it("gives a bill to a standalone subcategory budget", () => {
    const internet = item({ ...orange, categoryId: INTERNET });
    const r = run({
      items: [internet],
      budgetRows: [budget({ categoryId: INTERNET, parentId: HOUSING, parentName: "Housing", budgetCents: 10000 })],
    });
    expect(r.budgets[0].billsCents).toBe(6650);
    expect(r.budgets[0].reservedCents).toBe(3350);
  });

  it("adds confirmed income, ignores detected income and counts it", () => {
    const detected = item({ ...salary, id: "bonus", merchantKey: "BONUS", amountCents: 10000, status: "detected" });
    const r = run({ items: [salary, detected] });
    expect(r.incomeCents).toBe(250000);
    expect(r.income.map((i) => i.id)).toEqual(["salary"]);
    expect(r.ignoredDetectedIncomeCount).toBe(1);
    expect(r.safeCents).toBe(450000);
  });

  it("counts detected bills and flags them", () => {
    const r = run({ items: [item({ ...orange, status: "detected" })] });
    expect(r.bills[0].status).toBe("detected");
    expect(r.billsCents).toBe(6650);
  });

  it("counts last month's unseen bills when asOf is stale", () => {
    const r = run({
      accounts: [account({ asOf: "2026-08-20" })],
      items: [item({ ...edf, lastSeenDate: "2026-07-25" })],
      today: "2026-09-05",
    });
    // 2026-08-25 is after asOf and before today; 2026-09-25 is still to come.
    expect(r.bills.map((b) => b.date)).toEqual(["2026-08-25", "2026-09-25"]);
    expect(r.asOf).toBe("2026-08-20");
  });

  it("still counts a bill due on or before asOf that has not come yet", () => {
    // The bank balance is fetched today: a payment expected today is not booked yet.
    const golf = item({ id: "golf", name: "GOLF", merchantKey: "GOLF", amountCents: -3000, lastSeenDate: "2026-08-14" });
    const late = item({ id: "late", name: "LATE", merchantKey: "LATE", amountCents: -1000, lastSeenDate: "2026-08-10" });
    const r = run({ items: [golf, late, orange] });
    expect(r.bills.map((b) => [b.id, b.date])).toEqual([
      ["late", "2026-09-10"],
      ["golf", "2026-09-14"],
      ["orange", "2026-09-29"],
    ]);
    expect(r.billsCents).toBe(3000 + 1000 + 6650);
  });

  it("counts a weekly bill every time before month end", () => {
    const weekly = item({ id: "club", name: "CLUB FORME PLUS", interval: "weekly", amountCents: -1000, lastSeenDate: "2026-09-10" });
    const r = run({ items: [weekly] });
    expect(r.bills.map((b) => b.date)).toEqual(["2026-09-17", "2026-09-24"]);
    expect(r.billsCents).toBe(2000);
  });

  it("handles today being the last day of the month", () => {
    const r = run({
      accounts: [account({ asOf: "2026-09-30" })],
      // Paid on the 29th: nothing is left to come.
      items: [item({ ...orange, lastSeenDate: "2026-09-29" })],
      today: "2026-09-30",
    });
    expect(r.monthEnd).toBe("2026-09-30");
    expect(r.bills).toEqual([]);
    expect(r.safeCents).toBe(200000);
  });

  it("leaves out excluded accounts and accounts without a balance", () => {
    const r = run({
      accounts: [
        account(),
        account({ accountId: "a2", name: "Livret A", balanceCents: 900000, inSafeToSpend: false }),
        account({ accountId: "a3", name: "Joint", balanceCents: null, asOf: null }),
      ],
      items: [orange, item({ ...edf, accountId: "a2" })],
    });
    expect(r.balanceCents).toBe(200000);
    expect(r.missingBalanceAccounts).toEqual(["Joint"]);
    expect(r.noAccountCounted).toBe(false);
    expect(r.bills.map((b) => b.id)).toEqual(["orange"]);
  });

  it("flags when no account is counted", () => {
    const r = run({ accounts: [account({ balanceCents: null, asOf: null })] });
    expect(r.noAccountCounted).toBe(true);
    expect(r.asOf).toBeNull();
    expect(r.missingBalanceAccounts).toEqual(["Checking"]);
  });

  it("uses the earliest asOf of the counted accounts", () => {
    const r = run({ accounts: [account(), account({ accountId: "a2", name: "Joint", asOf: "2026-09-10" })] });
    expect(r.asOf).toBe("2026-09-10");
    expect(r.balanceCents).toBe(400000);
  });

  it("can be negative or exactly zero", () => {
    const short = run({ accounts: [account({ balanceCents: 10000 })], items: [orange, edf] });
    expect(short.safeCents).toBe(10000 - 15550);
    const zero = run({ accounts: [account({ balanceCents: 15550 })], items: [orange, edf] });
    expect(zero.safeCents).toBe(0);
  });

  it("ignores dismissed items", () => {
    const r = run({ items: [item({ ...orange, status: "dismissed" })] });
    expect(r.bills).toEqual([]);
  });
});
