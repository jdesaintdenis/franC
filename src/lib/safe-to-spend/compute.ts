import { monthRange } from "../dashboard/month";
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
  /** Confirmed income still due this month. */
  incomeCents: number;
  /** Positive: bills still due this month. */
  billsCents: number;
  /** Positive: sum of the budgets' reserved amounts. */
  budgetsLeftCents: number;
  /** balance + income - bills - budgets left; negative means overspent. */
  safeCents: number;
  bills: SafeToSpendBill[];
  income: SafeToSpendIncome[];
  budgets: SafeToSpendBudget[];
  /** Detected (unconfirmed) income occurrences left out of the number. */
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

function toBudget(item: BudgetItem, billsCents: number): SafeToSpendBudget {
  return {
    categoryId: item.categoryId,
    name: item.name,
    color: item.color,
    icon: item.icon,
    parentName: item.parentName,
    availableCents: item.availableCents,
    spentCents: item.spentCents,
    billsCents,
    reservedCents: Math.max(0, item.availableCents - item.spentCents - billsCents),
  };
}

function budgetsFor(
  rows: readonly BudgetRow[],
  bills: SafeToSpendBill[],
  parentOf: ReadonlyMap<string, string | null>,
): SafeToSpendBudget[] {
  const { items } = buildBudgetOverview(rows);
  const itemIds = new Set(items.map((i) => i.categoryId));
  const billsByItem = new Map<string, number>();
  for (const bill of bills) {
    const id = coveringBudgetId(bill.categoryId, parentOf, itemIds);
    if (id !== null) billsByItem.set(id, (billsByItem.get(id) ?? 0) + -bill.amountCents);
  }
  return items.map((item) => toBudget(item, billsByItem.get(item.categoryId) ?? 0));
}

/**
 * What can be spent until the end of the month: balance, plus confirmed income still due,
 * minus bills still due, minus what each budget still holds back. A bill inside a budget's
 * categories is taken out of that budget's reserve so it is counted once.
 */
export function buildSafeToSpend(args: {
  accounts: SafeToSpendAccount[];
  items: ForecastItem[];
  /** Budget rows of the current month (see buildBudgetOverview). */
  budgetRows: readonly BudgetRow[];
  /** category id -> parent id (null for top-level). */
  parentOf: ReadonlyMap<string, string | null>;
  /** "YYYY-MM-DD" */
  today: string;
}): SafeToSpendResult {
  const { accounts, items, budgetRows, parentOf, today } = args;
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
        income.push({ id: e.id, name: e.name, date: e.date, amountCents: e.amountCents, accountId: e.accountId });
      } else {
        ignoredDetectedIncomeCount += 1;
      }
    }
  }
  bills.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  income.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const budgets = budgetsFor(budgetRows, bills, parentOf);
  const balanceCents = counted.reduce((sum, a) => sum + a.balanceCents, 0);
  const incomeCents = income.reduce((sum, i) => sum + i.amountCents, 0);
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
    safeCents: balanceCents + incomeCents - billsCents - budgetsLeftCents,
    bills,
    income,
    budgets,
    ignoredDetectedIncomeCount,
  };
}
