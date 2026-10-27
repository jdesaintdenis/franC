import { addMonths, monthRange } from "../dashboard/month";
import { buildBudgetOverview, type BudgetItem, type BudgetRow } from "../budgets/progress";
import { addDays } from "../recurring/dates";
import { projectOccurrences, type ForecastItem } from "../recurring/forecast";

export interface SafeToSpendAccount {
  accountId: string;
  name: string;
  /** Balance at the end of `asOf`; null when no starting balance is set. */
  balanceCents: number | null;
  /** "YYYY-MM-DD"; null when no starting balance is set. */
  asOf: string | null;
  inSafeToSpend: boolean;
}

export interface SafeToSpendBill {
  /** Recurring item id. */
  id: string;
  name: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** Negative (outflow), as stored. */
  amountCents: number;
  status: "detected" | "confirmed";
  categoryId: string | null;
  accountId: string;
  /** Tracked by the user: the amount is an estimate, shown as "about". */
  tracked: boolean;
}

export interface SafeToSpendIncome {
  id: string;
  name: string;
  date: string;
  /** Positive. */
  amountCents: number;
  accountId: string;
  /** False when the income is kept for next month (see `keptIds`): listed, but not in the number. */
  countsNow: boolean;
}

/** An incoming row of a regular income kept for next month, already booked this month (Slice 76). */
export interface SafeToSpendReceived {
  id: string;
  date: string;
  /** Positive. */
  amountCents: number;
  label: string;
  /** The regular payment the row is a charge of. */
  recurringId: string;
}

/**
 * A row of this month switched to next month (Slice 79): an outflow "paid with next month's money" (negative), or an
 * incoming transfer from an account left out of Reste à vivre kept "for next month" (positive).
 */
export interface SafeToSpendPaidNext {
  id: string;
  date: string;
  /** As stored: negative for an expense, positive for an incoming transfer. */
  amountCents: number;
  label: string;
  categoryId: string | null;
}

// A regular income paid up to a week late (or early in the month) still funds its own month.
export const LEEWAY_LAST_DAY = 7;

/** Whether a "YYYY-MM-DD" date falls on the first LEEWAY_LAST_DAY days of its month. String maths, no Date. */
export function inLeeway(date: string): boolean {
  return Number(date.slice(8, 10)) <= LEEWAY_LAST_DAY;
}

export interface SafeToSpendBudget {
  categoryId: string;
  name: string;
  color: string;
  icon: string | null;
  parentName: string | null;
  /** Budget plus what rolled over from earlier months (Slice 29). */
  availableCents: number;
  spentCents: number;
  /** Positive: due bills of this budget's categories. Already part of `billsCents` in the result. */
  billsCents: number;
  /** What the budget still holds back: max(0, available - spent - bills). */
  reservedCents: number;
}

export interface SafeToSpendResult {
  /** Last day of today's month, "YYYY-MM-DD". */
  monthEnd: string;
  /** Earliest `asOf` of the counted accounts; null when none is counted. */
  asOf: string | null;
  /** True when no account could be counted: the caller shows a prompt instead of a number. */
  noAccountCounted: boolean;
  /** Names of accounts meant to count but lacking a starting balance. */
  missingBalanceAccounts: string[];
  balanceCents: number;
  /** Confirmed income still due this month that counts now (a kept payment counts only on the 1st-7th). */
  incomeCents: number;
  /** Positive: bills still due this month. */
  billsCents: number;
  /** Positive: sum of the budgets' reserved amounts. */
  budgetsLeftCents: number;
  /** balance - held + paid next + income - bills - budgets left; negative means overspent. */
  safeCents: number;
  /** True when at least one regular income is switched to "Keep for next month". */
  keepsIncome: boolean;
  /** "YYYY-MM" of the month after today's: the one the held income is kept for. */
  nextMonth: string;
  /** Income received this month from kept payments, outside the 1st-7th leeway. */
  heldForNextMonth: SafeToSpendReceived[];
  /** Positive: sum of `heldForNextMonth`. */
  heldCents: number;
  /** Expenses paid with the kept income (Slice 79); empty when no income is kept. */
  paidNext: SafeToSpendPaidNext[];
  /** Sum of `-amountCents` of `paidNext`, added to this month: expenses come out of what is kept, incoming transfers go into it. */
  paidNextCents: number;
  bills: SafeToSpendBill[];
  income: SafeToSpendIncome[];
  budgets: SafeToSpendBudget[];
  /** Detected (unconfirmed) income occurrences left out of the number (only those that would count now). */
  ignoredDetectedIncomeCount: number;
}

interface CountedAccount {
  accountId: string;
  balanceCents: number;
  asOf: string;
}

function countedAccounts(accounts: SafeToSpendAccount[]): CountedAccount[] {
  const counted: CountedAccount[] = [];
  for (const a of accounts) {
    if (a.inSafeToSpend && a.balanceCents !== null && a.asOf !== null) {
      counted.push({ accountId: a.accountId, balanceCents: a.balanceCents, asOf: a.asOf });
    }
  }
  return counted;
}

// The budget item covering a category: its own, else its parent's (children live inside their parent).
export function coveringBudgetId(
  categoryId: string | null | undefined,
  parentOf: ReadonlyMap<string, string | null>,
  itemIds: ReadonlySet<string>,
): string | null {
  if (!categoryId) return null;
  if (itemIds.has(categoryId)) return categoryId;
  const parent = parentOf.get(categoryId);
  return parent && itemIds.has(parent) ? parent : null;
}

function toBudget(item: BudgetItem, billsCents: number, paidNextCents: number): SafeToSpendBudget {
  return {
    categoryId: item.categoryId,
    name: item.name,
    color: item.color,
    icon: item.icon,
    parentName: item.parentName,
    availableCents: item.availableCents,
    spentCents: item.spentCents,
    billsCents,
    // An expense paid with next month's money must not free the budget's reserve too (it would count twice).
    reservedCents: Math.max(0, item.availableCents - (item.spentCents - paidNextCents) - billsCents),
  };
}

function budgetsFor(
  rows: readonly BudgetRow[],
  bills: SafeToSpendBill[],
  parentOf: ReadonlyMap<string, string | null>,
  paidNext: SafeToSpendPaidNext[],
): SafeToSpendBudget[] {
  const { items } = buildBudgetOverview(rows);
  const itemIds = new Set(items.map((i) => i.categoryId));
  const byItem = (lines: { categoryId: string | null; amountCents: number }[]) => {
    const totals = new Map<string, number>();
    for (const line of lines) {
      const id = coveringBudgetId(line.categoryId, parentOf, itemIds);
      if (id !== null) totals.set(id, (totals.get(id) ?? 0) + -line.amountCents);
    }
    return totals;
  };
  const billsByItem = byItem(bills);
  // Only expenses touch a budget; an incoming transfer has nothing to give back.
  const paidByItem = byItem(paidNext.filter((p) => p.amountCents < 0));
  return items.map((item) => toBudget(item, billsByItem.get(item.categoryId) ?? 0, paidByItem.get(item.categoryId) ?? 0));
}

/**
 * What can be spent until the end of the month: balance, minus what the regular incomes switched to
 * "Keep for next month" paid this month (it is next month's money), plus confirmed income still due
 * (a kept payment only on the 1st-7th), minus bills still due, minus what each budget still holds
 * back. A kept charge received on the 1st-7th is not held back; every other income counts at once. A bill inside
 * a budget's categories is taken out of that budget's reserve so it is counted once. An expense switched to
 * "Paid with next month's money" is added back: it comes out of what is kept, not out of this month (Slice 79).
 */
export function buildSafeToSpend(args: {
  accounts: SafeToSpendAccount[];
  items: ForecastItem[];
  /** Budget rows of the current month (see buildBudgetOverview). */
  budgetRows: readonly BudgetRow[];
  /** category id -> parent id (null for top-level). */
  parentOf: ReadonlyMap<string, string | null>;
  /** Charges booked this month on the counted accounts by the payments in `keptIds`. */
  received: SafeToSpendReceived[];
  /** Ids of the regular incomes switched to "Keep for next month". */
  keptIds: ReadonlySet<string>;
  /** This month's outflows switched to "Paid with next month's money" on the counted accounts. */
  paidNext?: SafeToSpendPaidNext[];
  /** "YYYY-MM-DD" */
  today: string;
}): SafeToSpendResult {
  const { accounts, items, budgetRows, parentOf, received, keptIds, today } = args;
  // Without a kept income there is no next month's money to pay with: the switch has no effect.
  const paidNext = keptIds.size > 0 ? (args.paidNext ?? []) : [];
  const { from: monthStart, to: monthEnd } = monthRange(today.slice(0, 7));
  const counted = countedAccounts(accounts);
  const bills: SafeToSpendBill[] = [];
  const income: SafeToSpendIncome[] = [];
  let ignoredDetectedIncomeCount = 0;

  for (const account of counted) {
    const mine = items.filter((i) => i.accountId === account.accountId);
    // From asOf + 1, not today: payments expected since the last import aren't in the balance yet.
    // Also from the month's start: an occurrence on or before asOf that never came (a payment due
    // today that the bank has not booked yet, or a late one) is not in the balance either.
    const after = addDays(account.asOf, 1);
    for (const e of projectOccurrences(mine, after < monthStart ? after : monthStart, monthEnd)) {
      if (e.amountCents < 0) {
        if (e.status === "dismissed" || e.status === "ended") continue;
        bills.push({
          id: e.id,
          name: e.name,
          date: e.date,
          amountCents: e.amountCents,
          status: e.status,
          categoryId: e.categoryId ?? null,
          accountId: e.accountId,
          tracked: e.tracked === true,
        });
      } else if (e.status === "confirmed") {
        const countsNow = !keptIds.has(e.id) || inLeeway(e.date);
        income.push({ id: e.id, name: e.name, date: e.date, amountCents: e.amountCents, accountId: e.accountId, countsNow });
      } else if (!keptIds.has(e.id) || inLeeway(e.date)) {
        ignoredDetectedIncomeCount += 1;
      }
    }
  }
  bills.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  income.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const budgets = budgetsFor(budgetRows, bills, parentOf, paidNext);
  const balanceCents = counted.reduce((sum, a) => sum + a.balanceCents, 0);
  const incomeCents = income.reduce((sum, i) => (i.countsNow ? sum + i.amountCents : sum), 0);
  const heldForNextMonth = received.filter((r) => !inLeeway(r.date));
  const heldCents = heldForNextMonth.reduce((sum, r) => sum + r.amountCents, 0);
  const paidNextCents = paidNext.reduce((sum, p) => sum - p.amountCents, 0);
  const billsCents = bills.reduce((sum, b) => sum - b.amountCents, 0);
  const budgetsLeftCents = budgets.reduce((sum, b) => sum + b.reservedCents, 0);

  return {
    monthEnd,
    asOf: counted.reduce<string | null>((min, a) => (min === null || a.asOf < min ? a.asOf : min), null),
    noAccountCounted: counted.length === 0,
    missingBalanceAccounts: accounts
      .filter((a) => a.inSafeToSpend && (a.balanceCents === null || a.asOf === null))
      .map((a) => a.name),
    balanceCents,
    incomeCents,
    billsCents,
    budgetsLeftCents,
    safeCents: balanceCents - heldCents + paidNextCents + incomeCents - billsCents - budgetsLeftCents,
    keepsIncome: keptIds.size > 0,
    nextMonth: addMonths(today.slice(0, 7), 1),
    heldForNextMonth,
    heldCents,
    paidNext,
    paidNextCents,
    bills,
    income,
    budgets,
    ignoredDetectedIncomeCount,
  };
}
