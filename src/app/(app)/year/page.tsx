import { CalendarDays } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/db/client";
import { listAccounts } from "@/db/queries/accounts";
import { getMonthlyTrend, getMonthTotals, getSpendingByCategory } from "@/db/queries/dashboard";
import { getSavedByMonth } from "@/db/queries/savings";
import {
  getCategorySpendingByMonth,
  getFirstMonthWithData,
  getIncomeBySource,
  getYearsWithData,
} from "@/db/queries/year";
import { requireUser } from "@/lib/auth/session";
import { labelUncategorized } from "@/lib/categorize/uncategorized";
import { currentMonth, monthRange, parseMonthParam } from "@/lib/dashboard/month";
import { yearEmptyAlternative } from "@/lib/empty-state/choice";
import { buildCategoryMatrix, monthlyAverage } from "@/lib/year/averages";
import { bestAndWorstMonths } from "@/lib/year/highlights";
import { monthsCovered, monthsOfYear, parseYearParam, yearRange } from "@/lib/year/year";

import { CATEGORY_ROWS_SHOWN, CategorySpending } from "../category-spending";
import { HomeSection } from "../home/home-section";
import { CategoryYearRows } from "./category-year-rows";
import { spendingHref, yearHref } from "./hrefs";
import { IncomeSources } from "./income-sources";
import { PeriodSheet } from "./period-sheet";
import { YearHeadline } from "./year-headline";
import { YearMonths } from "./year-months";
import { YearNetBars } from "./year-net-bars";
import { YearTitle } from "./year-title";

export default async function YearPage({ searchParams }: PageProps<"/year">) {
  const t = await getTranslations("year");
  const nav = await getTranslations("common.nav");
  const glossary = await getTranslations("common.glossary");
  const user = await requireUser();
  const now = currentMonth(new Date());
  const currentYear = Number(now.slice(0, 4));
  const params = await searchParams;
  const year = parseYearParam(params.year, currentYear);
  const months = monthsOfYear(year);

  const accounts = await listAccounts(user.id);

  // "Where the money went" covers the whole year or one past-or-current month of it.
  const requestedFlow = parseMonthParam(params.flow, "year");
  const flowMonth = requestedFlow !== "year" && months.includes(requestedFlow) && requestedFlow <= now ? requestedFlow : null;
  const flowRange = flowMonth ? monthRange(flowMonth) : yearRange(year);
  const period = flowMonth ? { month: flowMonth } : { year };

  const [years, totals, trendRows, categoryRowsRaw, firstMonth, incomeRows, spendingRows, savedByMonth] = await Promise.all([
    getYearsWithData(db, user.id),
    getMonthTotals(db, user.id, yearRange(year)),
    getMonthlyTrend(db, user.id, months[0], months[11]),
    getCategorySpendingByMonth(db, user.id, year),
    getFirstMonthWithData(db, user.id, year),
    getIncomeBySource(db, user.id, flowRange),
    getSpendingByCategory(db, user.id, flowRange),
    getSavedByMonth(db, user.id, yearRange(year)),
  ]);
  const showSaved = accounts.some((a) => a.savings);
  const uncategorized = glossary("uncategorized");
  const categoryRows = labelUncategorized(categoryRowsRaw, uncategorized);
  const incomeBySource = labelUncategorized(incomeRows, uncategorized);
  const spending = labelUncategorized(spendingRows, uncategorized);

  const header = (
    <>
      <PageHeader title={<PageTitle>{t("title")}</PageTitle>} back={{ href: "/budget", label: nav("backToPlan") }} />
      <YearTitle year={year} currentYear={currentYear} firstYear={years[0] ?? null} />
    </>
  );
  const shell = (children: React.ReactNode) => (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 pb-6 md:px-8 lg:max-w-5xl">{children}</main>
    </div>
  );

  if (totals.count === 0) {
    const alternative = yearEmptyAlternative(year, years.length > 0 ? years[years.length - 1] : null);
    return shell(
      <>
        {header}
        <EmptyState
          icon={CalendarDays}
          title={t("empty.title", { year })}
          body={t("empty.body")}
          action={
            <Link href="/import" className={buttonVariants({ className: "h-11" })}>
              {t("empty.import")}
            </Link>
          }
          secondary={
            alternative !== null && (
              <Link
                href={yearHref({ year: alternative === currentYear ? null : alternative })}
                className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center"
              >
                {t("empty.goToYear", { year: alternative })}
              </Link>
            )
          }
        />
      </>,
    );
  }

  const trendByMonth = new Map(trendRows.map((r) => [r.month, r]));
  const monthRows = months.map((month) => {
    const row = trendByMonth.get(month);
    return {
      month,
      hasData: row !== undefined,
      incomeCents: row?.incomeCents ?? 0,
      spentCents: row?.spentCents ?? 0,
      savedCents: savedByMonth.get(month) ?? 0,
      future: month > now,
    };
  });
  // A month is in the trend only when it has at least one non-transfer transaction.
  const highlights = bestAndWorstMonths(monthRows, now);

  const covered = monthsCovered(year, firstMonth, now);
  const matrix = buildCategoryMatrix(categoryRows, months, covered);
  const futureFrom = months.find((m) => m > now) ?? null;

  const flowSpentCents = spending.reduce((sum, s) => sum + s.spentCents, 0);

  return shell(
    <>
      {header}
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6">
        <div className="flex flex-col gap-2">
          <HomeSection headingId="year-heading" title={t("headline.label")}>
            <YearHeadline
              year={year}
              currentYear={currentYear}
              incomeCents={totals.incomeCents}
              spentCents={totals.spentCents}
              perMonthCents={monthlyAverage(totals.spentCents, covered.length)}
              highlights={highlights}
            />
          </HomeSection>
          <HomeSection headingId="year-monthly" title={t("monthly.heading")}>
            <YearNetBars
              months={monthRows.map((r) => ({
                month: r.month,
                netCents: r.incomeCents - r.spentCents,
                empty: r.future || !r.hasData,
                current: r.month === now,
              }))}
              bestMonth={highlights?.best.month ?? null}
            />
          </HomeSection>
          <HomeSection headingId="year-months" title={t("monthly.listHeading")} flush>
            <YearMonths
              rows={monthRows
                .filter((r) => !r.future && r.hasData)
                .reverse()
                .map((r) => ({ ...r, current: r.month === now }))}
              showSaved={showSaved}
            />
          </HomeSection>
        </div>
        <div className="flex flex-col gap-2">
          {spending.length === 0 ? (
            <HomeSection headingId="year-flow" title={t("flow.heading")}>
              <p className="text-muted-foreground text-sm">{t("flow.empty")}</p>
            </HomeSection>
          ) : (
            <CategorySpending
              totalCents={flowSpentCents}
              visibleCount={CATEGORY_ROWS_SHOWN}
              heading={t("flow.heading")}
              aside={
                <PeriodSheet
                  year={year}
                  currentYear={currentYear}
                  selected={flowMonth ?? "year"}
                  months={monthRows.map((r) => ({ month: r.month, spentCents: r.spentCents, future: r.future }))}
                  yearSpentCents={totals.spentCents}
                />
              }
              slices={spending.map((c) => ({
                key: c.categoryId ?? "none",
                name: c.name,
                color: c.color,
                icon: c.icon,
                spentCents: c.spentCents,
                href: spendingHref(period, c.categoryId),
              }))}
            />
          )}
          {incomeBySource.length > 0 && (
            <HomeSection headingId="year-sources" title={t("flow.sourcesHeading")} flush>
              <IncomeSources
                rows={incomeBySource.map((r) => ({
                  categoryId: r.categoryId,
                  name: r.name,
                  color: r.color,
                  icon: r.icon,
                  amountCents: r.amountCents,
                }))}
                period={period}
              />
            </HomeSection>
          )}
          <HomeSection headingId="year-categories" title={t("categories.heading")} flush={matrix.rows.length > 0}>
            {matrix.rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("categories.empty", { year })}</p>
            ) : (
              <CategoryYearRows year={year} months={months} futureFrom={futureFrom} matrix={matrix} coveredCount={covered.length} />
            )}
          </HomeSection>
        </div>
      </div>
    </>,
  );
}
