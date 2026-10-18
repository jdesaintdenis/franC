import { db } from "@/db/client";
import { getBudgetProgress } from "@/db/queries/budgets";
import { listCategories } from "@/db/queries/categories";
import { getAccountFreshness } from "@/db/queries/import-reminder";
import { listRecurring } from "@/db/queries/recurring";
import { buildBudgetOverview } from "@/lib/budgets/progress";
import { addMonths, currentDate, currentMonth, monthRange } from "@/lib/dashboard/month";
import { dataUpTo } from "@/lib/import-reminder/staleness";
import { forecastMonth, toForecastItem } from "@/lib/recurring/forecast";
import { nextMonthOutlook } from "@/lib/recurring/next-month";

/** Everything the Next month page shows: the forecast, what it leaves after budgets, and the rows' categories. */
export async function loadNextMonth(userId: string, now: Date) {
  const month = addMonths(currentMonth(now), 1);
  const [items, freshness, categories, budgetRows] = await Promise.all([
    // Ended and dismissed items are left out by default, as the forecast wants.
    listRecurring(db, userId),
    getAccountFreshness(db, userId, { withoutBankLink: true }),
    listCategories(userId),
    // Next month's budgets are the base amounts: nobody knows yet what rolls over.
    getBudgetProgress(db, userId, monthRange(currentMonth(now))),
  ]);
  const forecast = forecastMonth(items.map(toForecastItem), month);
  const budgets = buildBudgetOverview(budgetRows).items;
  const outlook = nextMonthOutlook({
    entries: forecast.entries,
    budgets,
    parentOf: new Map(categories.map((c) => [c.id, c.parentId])),
  });
  return {
    month,
    today: currentDate(now),
    forecast,
    outlook,
    budgets,
    categories: new Map(categories.map((c) => [c.id, { name: c.name, color: c.color, icon: c.icon }])),
    dataUpTo: dataUpTo(freshness),
  };
}
