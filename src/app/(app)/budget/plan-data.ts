import { db } from "@/db/client";
import { listAccounts } from "@/db/queries/accounts";
import { getAccountBalances, getDailyNet } from "@/db/queries/balance";
import { getBudgetProgress, getRecurringCharges, getUnlinkedSpendingByCategory, type RecurringChargeRow } from "@/db/queries/budgets";
import { listCategories } from "@/db/queries/categories";
import {
  countTransfersInRange,
  getMonthlyHistory,
  getMonthTotals,
  getSpendingByCategory,
  getSubcategoryBreakdown,
  getSubcategorySpending,
  type SubcategorySpending,
} from "@/db/queries/dashboard";
import { listGoals } from "@/db/queries/goals";
import { getAccountFreshness } from "@/db/queries/import-reminder";
import { listRecurring } from "@/db/queries/recurring";
import { getSavedByMonth } from "@/db/queries/savings";
import { buildBalanceOverview } from "@/lib/balance/projection";
import { monthBalanceCurve, sumCurves, type MonthCurvePoint } from "@/lib/balance/month-curve";
import { chargesByEntry, chargesPresetCents } from "@/lib/budgets/charges";
import { attachCharges, buildBudgetOverview, type BudgetOverview } from "@/lib/budgets/progress";
import { outsideBudgetCents, plannedSpendingCents } from "@/lib/budgets/planned";
import { budgetVerdict } from "@/lib/budgets/verdict";
import { addMonths, currentDate, currentMonth, monthRange } from "@/lib/dashboard/month";
import { latestMonthWithData } from "@/lib/dashboard/month-picker";
import { monthBarScale, monthBarWindow } from "@/lib/dashboard/month-bars";
import { addDays } from "@/lib/recurring/dates";
import { comingUp, forecastMonth, toForecastItem } from "@/lib/recurring/forecast";
import { yearlyTotals } from "@/lib/recurring/list-view";
import { buildSafeToSpend } from "@/lib/safe-to-spend/compute";
import { monthProgress } from "@/lib/safe-to-spend/per-day";

/** What running outflows cost per month: the yearly sum over 12, integer cents, rounded down. */
function perMonthCents(items: Parameters<typeof yearlyTotals>[0]): number {
  const { confirmedOutCents, detectedOutCents } = yearlyTotals(items);
  return Math.floor((confirmedOutCents + detectedOutCents) / 12);
}

/**
 * Each budget entry with the regular payments of its categories: those paid in the month, and (current
 * month only) the bills still due, the same ones Reste à vivre subtracts.
 */
function withCharges(
  overview: BudgetOverview,
  args: {
    paid: RecurringChargeRow[];
    due: Parameters<typeof chargesByEntry>[0]["due"];
    recurring: { id: string; name: string }[];
    parentOf: ReadonlyMap<string, string | null>;
  },
): BudgetOverview {
  const categoryIds = overview.items.flatMap((item) => [item.categoryId, ...item.children.map((c) => c.categoryId)]);
  return attachCharges(
    overview,
    chargesByEntry({
      categoryIds,
      paid: args.paid,
      due: args.due,
      names: new Map(args.recurring.map((r) => [r.id, r.name])),
      parentOf: args.parentOf,
    }),
  );
}

/**
 * Everything the Budget page shows for one month, over all accounts (SPEC §74 D). The pace, the
 * bills inside budgets and the coming-up list are always about today, as on Home; only the numbers
 * of the month (totals, budgets, categories, the balance curve) follow the selected month.
 */
export async function loadBudgetMonth(userId: string, now: Date, month: string, parentId: string | null) {
  const today = currentDate(now);
  const current = currentMonth(now);
  const isCurrent = month === current;
  const range = monthRange(month);

  const [
    totals,
    transferCount,
    savedByMonth,
    byCategoryRows,
    subBreakdown,
    breakdown,
    history,
    recurring,
    budgetRows,
    currentBudgetRows,
    categories,
    goals,
    accounts,
    balances,
    freshness,
    unlinkedSpending,
    paidCharges,
  ] = await Promise.all([
    getMonthTotals(db, userId, range),
    countTransfersInRange(db, userId, range),
    getSavedByMonth(db, userId, range),
    getSpendingByCategory(db, userId, range),
    // Skipped on a breakdown page, whose slices are already subcategories.
    parentId ? new Map<string, SubcategorySpending[]>() : getSubcategoryBreakdown(db, userId, range),
    parentId ? getSubcategorySpending(db, userId, range, parentId) : null,
    getMonthlyHistory(db, userId),
    listRecurring(db, userId),
    getBudgetProgress(db, userId, range),
    isCurrent ? null : getBudgetProgress(db, userId, monthRange(current)),
    listCategories(userId),
    listGoals(db, userId),
    listAccounts(userId),
    getAccountBalances(db, userId),
    getAccountFreshness(db, userId, { withoutBankLink: true }),
    getUnlinkedSpendingByCategory(db, userId, range),
    getRecurringCharges(db, userId, range),
  ]);

  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  const forecastItems = recurring.map(toForecastItem);

  // Always the current month's budgets feed the pace and the bills, whichever month is selected.
  const safeToSpend = buildSafeToSpend({
    accounts: balances.map((b) => ({
      accountId: b.id,
      name: b.name,
      balanceCents: b.balanceCents,
      asOf: b.asOf,
      inSafeToSpend: b.inSafeToSpend,
    })),
    items: forecastItems,
    budgetRows: currentBudgetRows ?? budgetRows,
    parentOf,
    today,
  });
  const progress = monthProgress(today);
  const pace = { ...progress, billsDueCents: new Map(safeToSpend.budgets.map((b) => [b.categoryId, b.billsCents])) };
  const currentOverview = buildBudgetOverview(currentBudgetRows ?? budgetRows, pace);
  const budgets = withCharges(isCurrent ? currentOverview : buildBudgetOverview(budgetRows), {
    paid: paidCharges,
    due: isCurrent ? safeToSpend.bills : [],
    recurring,
    parentOf,
  });

  const plannedCents = plannedSpendingCents({
    budgets: budgets.items,
    entries: forecastMonth(forecastItems, month).entries,
    paid: paidCharges,
    parentOf,
  });
  const outsideCents = outsideBudgetCents({
    spending: unlinkedSpending,
    budgetIds: new Set(budgets.items.map((i) => i.categoryId)),
    parentOf,
  });
  // Next month's budgets are the base amounts: nobody knows yet what rolls over.
  const nextMonth = forecastMonth(forecastItems, addMonths(current, 1));
  const nextPlannedCents = plannedSpendingCents({
    budgets: currentOverview.items.map((i) => ({ categoryId: i.categoryId, availableCents: i.budgetCents })),
    entries: nextMonth.entries,
    parentOf,
  });
  const bars = monthBarWindow({
    selected: month,
    current,
    spentByMonth: new Map(history.map((h) => [h.month, h.spentCents])),
    nextPlannedCents,
  });
  const previous = history.find((h) => h.month === addMonths(month, -1));
  const verdict = budgetVerdict(budgets, { isCurrent, daysLeft: progress.daysInMonth - progress.day });

  const incomeDue =
    isCurrent && safeToSpend.income.length > 0
      ? {
          cents: safeToSpend.income.reduce((sum, i) => sum + i.amountCents, 0),
          date: safeToSpend.income.reduce((min, i) => (i.date < min ? i.date : min), safeToSpend.income[0]?.date ?? today),
        }
      : null;

  const balance = await loadBalance({ userId, month, range, isCurrent, today, balances, forecastItems, spreadCents: safeToSpend.budgetsLeftCents });

  return {
    today,
    current,
    month,
    isCurrent,
    totals,
    transferCount,
    savedCents: accounts.some((a) => a.savings) ? (savedByMonth.get(month) ?? 0) : undefined,
    byCategoryRows,
    subBreakdown,
    breakdown,
    history,
    latest: latestMonthWithData(history),
    freshness,
    budgets,
    pace: isCurrent ? progress : undefined,
    hasCategories: categories.length > 0,
    plannedCents,
    outsideCents,
    bars,
    barScale: monthBarScale(bars, plannedCents),
    previousSpentCents: previous && previous.count > 0 ? previous.spentCents : null,
    verdict,
    incomeDue,
    upcoming: comingUp(forecastItems, today),
    hasRecurring: recurring.length > 0,
    goals,
    hasSavingsAccount: accounts.some((a) => a.savings),
    balance,
    // Plan-page links.
    recurringCount: recurring.length,
    recurringPerMonthCents: perMonthCents(recurring),
    recurringToConfirm: recurring.filter((r) => r.status === "detected").length,
    nextMonth,
    // What the Next month page leads with: its income minus its plan.
    nextMonthLeftCents: nextMonth.summary.all.inCents - nextPlannedCents,
    year: Number(current.slice(0, 4)),
  };
}

/** The Solde card: the 30-day overview (about now) and the selected month's curve (SPEC §74 C). */
async function loadBalance(args: {
  userId: string;
  month: string;
  range: { from: string; to: string };
  isCurrent: boolean;
  today: string;
  balances: Awaited<ReturnType<typeof getAccountBalances>>;
  forecastItems: ReturnType<typeof toForecastItem>[];
  spreadCents: number;
}) {
  const { userId, range, isCurrent, today, balances, forecastItems, spreadCents } = args;
  const known = balances.flatMap((b) =>
    b.balanceCents !== null && b.asOf !== null
      ? [{ accountId: b.id, name: b.name, balanceCents: b.balanceCents, asOf: b.asOf, thresholdCents: b.thresholdCents }]
      : [],
  );
  const overview = buildBalanceOverview({ accounts: known, items: forecastItems, today });
  const missing = balances.filter((b) => b.balanceCents === null).map((b) => b.name);

  let curve: MonthCurvePoint[] = [];
  let noData = false;
  if (known.length > 0) {
    const asOfMax = known.reduce((max, a) => (a.asOf > max ? a.asOf : max), known[0].asOf);
    const { rows, earliest } = await getDailyNet(db, userId, {
      accountIds: known.map((a) => a.accountId),
      from: addDays(range.from, -1),
      to: asOfMax,
    });
    // Before the first row and before the balance was first set there is nothing to rebuild from.
    const anchors = balances.flatMap((b) => (b.balanceCents !== null ? [b.startingBalanceDate ?? b.asOf] : []));
    const floor = [earliest, ...anchors].filter((d): d is string => d !== null).reduce((min, d) => (d < min ? d : min));
    noData = range.to < floor;
    if (!noData) {
      const netByAccount = new Map<string, Map<string, number>>();
      for (const r of rows) {
        const days = netByAccount.get(r.accountId) ?? new Map<string, number>();
        days.set(r.date, r.netCents);
        netByAccount.set(r.accountId, days);
      }
      const perAccount = known.map((a, i) => {
        const account = overview.accounts.find((o) => o.accountId === a.accountId);
        return monthBalanceCurve({
          balanceCents: a.balanceCents,
          asOf: a.asOf,
          dailyNet: netByAccount.get(a.accountId) ?? new Map(),
          projection: account?.series ?? [],
          // The budgets' remaining reserve is one figure for all accounts: the first carries it.
          spreadCents: isCurrent && i === 0 ? spreadCents : 0,
          monthStart: range.from,
          monthEnd: range.to,
        });
      });
      curve = known.length === 1 ? perAccount[0] : sumCurves(perAccount);
    }
  }

  return {
    overview,
    missing,
    any: balances.some((b) => b.balanceCents !== null),
    curve,
    noData,
    bankReadAt: balances.flatMap((b) => (b.source === "bank" && b.asOf !== null ? [{ id: b.id, asOf: b.asOf, fetchedAt: b.fetchedAt }] : [])),
  };
}

/**
 * This month's budgets with the same pace as Home, for the budgets settings page (which keeps its
 * own screen). The Budget page itself uses `loadBudgetMonth`.
 */
export async function loadPlan(userId: string, now: Date) {
  const today = currentDate(now);
  const month = currentMonth(now);
  const range = monthRange(month);
  const [budgetRows, categories, recurring, balances, paidCharges] = await Promise.all([
    getBudgetProgress(db, userId, range),
    listCategories(userId),
    listRecurring(db, userId),
    getAccountBalances(db, userId),
    getRecurringCharges(db, userId, range),
  ]);
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  // Only the per-budget bills are used, so pace matches Home's budgets card exactly.
  const safeToSpend = buildSafeToSpend({
    accounts: balances.map((b) => ({
      accountId: b.id,
      name: b.name,
      balanceCents: b.balanceCents,
      asOf: b.asOf,
      inSafeToSpend: b.inSafeToSpend,
    })),
    items: recurring.map(toForecastItem),
    budgetRows,
    parentOf,
    today,
  });
  const budgets = withCharges(
    buildBudgetOverview(budgetRows, {
      day: Number(today.slice(8, 10)),
      daysInMonth: Number(range.to.slice(8, 10)),
      billsDueCents: new Map(safeToSpend.budgets.map((b) => [b.categoryId, b.billsCents])),
    }),
    { paid: paidCharges, due: safeToSpend.bills, recurring, parentOf },
  );
  // The budget sheet's "Payments" pill: this month's regular payments per category.
  const forecast = forecastMonth(recurring.map(toForecastItem), month).entries;
  const chargePresets: Record<string, { cents: number; names: { name: string; day: number }[] }> = {};
  for (const c of categories) {
    const preset = chargesPresetCents(forecast, c.id, parentOf);
    if (preset.cents > 0) chargePresets[c.id] = preset;
  }
  return { today, month, daysLeft: Number(range.to.slice(8, 10)) - Number(today.slice(8, 10)), budgets, chargePresets };
}
