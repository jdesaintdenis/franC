import { CalendarDays, CalendarRange, ChartColumn, PiggyBank, Repeat } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RowLink } from "@/components/row-link";
import { buttonVariants } from "@/components/ui/button";
import type { SubcategorySpending } from "@/db/queries/dashboard";
import { requireUser } from "@/lib/auth/session";
import { labelUncategorized } from "@/lib/categorize/uncategorized";
import {
  categoryDrillDownHref,
  currentMonth,
  dashboardHref,
  formatMonthLabel,
  formatMonthName,
  inSentence,
  monthTransfersHref,
  parseCategoryParam,
  parseMonthParam,
  subcategoryBreakdownHref,
} from "@/lib/dashboard/month";
import { formatShortDay, formatShortInstantTime } from "@/lib/format-date";
import { formatCents, formatSignedWholeCents, formatWholeCents } from "@/lib/money";

import { BalanceCard, BalancePrompt } from "../balance-card";
import { CATEGORY_ROWS_SHOWN, CategorySpending, type SubcategorySlice } from "../category-spending";
import { ComingUp } from "../coming-up";
import { DataUpTo } from "../data-up-to";
import { HomeBudgets, HomeBudgetsPrompt } from "../home/home-budgets";
import { HomeGoals } from "../home/home-goals";
import { HomeSection } from "../home/home-section";
import { MonthCard } from "./month-card";
import { MonthTitle } from "./month-title";
import { loadBudgetMonth } from "./plan-data";
import { TransfersNote } from "./transfers-note";

/**
 * The Budget tab: one page for any month (`?month=`), over all accounts. The month card, then
 * budgets, where the money went, what is coming, goals and the balance curve (SPEC §74).
 */
export default async function BudgetPage({ searchParams }: PageProps<"/budget">) {
  const [user, locale, t, tm, tc, td, tEmpty, glossary] = await Promise.all([
    requireUser(),
    getLocale(),
    getTranslations("plan"),
    getTranslations("plan.month"),
    getTranslations("dashboard.categorySpending"),
    getTranslations("dashboard.empty"),
    getTranslations("common.emptyState"),
    getTranslations("common.glossary"),
  ]);
  const now = new Date();
  const params = await searchParams;
  const month = parseMonthParam(params.month, currentMonth(now));
  const data = await loadBudgetMonth(user.id, now, month, parseCategoryParam(params.category));
  const { today, current, isCurrent, totals, balance } = data;

  const byCategory = labelUncategorized(data.byCategoryRows, glossary("uncategorized"));
  const parentName =
    data.breakdown?.find((b) => b.isParentItself)?.name ?? byCategory.find((c) => c.categoryId === parseCategoryParam(params.category))?.name;
  const parentId = parseCategoryParam(params.category);
  const drillDown = parentId && data.breakdown ? { parentId, parentName: parentName ?? "", buckets: data.breakdown } : null;
  const monthHref = dashboardHref({ month: isCurrent ? null : month });
  const nextMonthLabel = formatMonthLabel(data.nextMonth.month, locale);
  const bankReadAt = Object.fromEntries(
    balance.bankReadAt.map((b) => [b.id, b.fetchedAt ? formatShortInstantTime(b.fetchedAt, today, locale) : formatShortDay(b.asOf, today, locale)]),
  );
  const hasSpending = totals.count > 0;

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 pb-6 md:px-8 lg:max-w-5xl">
        <PageHeader
          eyebrow={<DataUpTo accounts={data.freshness} today={today} listLagging />}
          title={<span className="font-title text-[22px] font-bold tracking-[0.1em] uppercase">{t("title")}</span>}
          action={<MonthTitle month={month} current={current} history={data.history} />}
        />
        <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6">
          <div className="flex flex-col gap-2">
            <HomeSection headingId="month-heading" title={tm("titleMonth")} testId="month-card">
              <MonthCard
                month={month}
                current={current}
                today={today}
                pace={data.pace}
                hasSpending={hasSpending}
                spentCents={totals.spentCents}
                incomeCents={totals.incomeCents}
                netCents={totals.netCents}
                plannedCents={data.plannedCents}
                outsideCents={data.outsideCents}
                incomeDue={data.incomeDue}
                previousSpentCents={data.previousSpentCents}
                bars={data.bars}
                barScale={data.barScale}
                verdict={data.verdict}
              />
            </HomeSection>
            <TransfersNote count={data.transferCount} href={monthTransfersHref(month, null)} />
            {!hasSpending && (
              <EmptyState
                icon={CalendarDays}
                title={td("title", { month: inSentence(formatMonthLabel(month, locale), locale) })}
                body={td("body")}
                action={
                  <Link href="/import" className={buttonVariants({ className: "h-11" })}>
                    {tEmpty("import")}
                  </Link>
                }
                secondary={
                  data.latest &&
                  data.latest !== month && (
                    <Link
                      href={dashboardHref({ month: data.latest === current ? null : data.latest })}
                      className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center underline underline-offset-4"
                    >
                      {td("goToMonth", { month: inSentence(formatMonthLabel(data.latest, locale), locale) })}
                    </Link>
                  )
                }
              />
            )}
            {/* Where the money went comes before how each budget stands (SPEC §82). */}
            {hasSpending &&
              (drillDown ? (
                <>
                  <div className="bg-card overflow-hidden rounded-lg border">
                    <RowLink href={monthHref} title={tc("back")} scroll={false} />
                  </div>
                  <CategorySpending
                    heading={tc("breakdownHeading", { category: drillDown.parentName, month: formatMonthLabel(month, locale) })}
                    shareOf={drillDown.parentName}
                    totalCents={drillDown.buckets.reduce((sum, b) => sum + b.spentCents, 0)}
                    slices={drillDown.buckets.map((b) => ({
                      key: b.categoryId,
                      name: b.isParentItself ? tc("noSubcategory", { category: b.name }) : b.name,
                      color: b.color,
                      icon: b.icon,
                      spentCents: b.spentCents,
                      // The "(no subcategory)" bucket links to the parent's list, which
                      // also includes its subcategories: the filter cannot exclude them.
                      href: categoryDrillDownHref(month, b.categoryId, null),
                    }))}
                  />
                  <div className="bg-card overflow-hidden rounded-lg border">
                    <RowLink href={categoryDrillDownHref(month, drillDown.parentId, null)} title={tc("seeAll")} />
                  </div>
                </>
              ) : (
                <CategorySpending
                  totalCents={totals.spentCents}
                  visibleCount={CATEGORY_ROWS_SHOWN}
                  slices={byCategory.map((c) => ({
                    key: c.categoryId ?? "none",
                    name: c.name,
                    color: c.color,
                    icon: c.icon,
                    spentCents: c.spentCents,
                    subcategories: c.categoryId
                      ? subcategorySlices(data.subBreakdown.get(c.categoryId), (name) => tc("noSubcategory", { category: name }))
                      : undefined,
                    href:
                      c.categoryId && c.hasSubcategorySpending
                        ? subcategoryBreakdownHref(month, c.categoryId)
                        : categoryDrillDownHref(month, c.categoryId, null),
                  }))}
                />
              ))}
          </div>
          <div className="flex flex-col gap-2">
            {hasSpending && (data.budgets.items.length > 0 || data.hasCategories) && (
              <HomeSection headingId="budgets-heading" title={tm("budgets")} link={{ href: "/settings/budgets", label: tm("edit") }} testId="plan-budgets-section">
                {data.budgets.items.length > 0 ? (
                  <HomeBudgets overview={data.budgets} month={month} pace={data.pace} max={Infinity} showCharges foldChargesOnly testId="plan-budgets" />
                ) : (
                  <HomeBudgetsPrompt />
                )}
              </HomeSection>
            )}
            {isCurrent && data.hasRecurring && (
              <HomeSection headingId="coming-up-heading" title={tm("upcoming")} link={{ href: "/recurring", label: tm("recurringLink") }}>
                <ComingUp entries={data.upcoming} today={today} />
              </HomeSection>
            )}
            <HomeSection
              headingId="goals-heading"
              title={tm("goals")}
              link={data.goals.length > 0 ? { href: "/settings/goals", label: tm("manage") } : undefined}
              testId="plan-goals-section"
            >
              <div className="flex flex-col gap-2">
                {data.goals.length > 0 ? (
                  <HomeGoals goals={data.goals} today={today} max={Infinity} testId="plan-goals" />
                ) : (
                  <div className="-mx-1">
                    <RowLink href="/settings/goals" title={t("noGoals")} hint={t("noGoalsHint")} icon={<PiggyBank />} />
                  </div>
                )}
                {data.hasSavingsAccount && data.savedCents !== undefined && (
                  <p className="text-muted-foreground text-xs" data-testid="saved-in">
                    {tm("savedIn", { month: inSentence(formatMonthName(month, locale), locale), amount: formatCents(data.savedCents, locale) })}
                  </p>
                )}
              </div>
            </HomeSection>
            {balance.any ? (
              <HomeSection id="balance" headingId="balance-heading" title={tm("balance")} testId="balance">
                <BalanceCard
                  overview={balance.overview}
                  missing={balance.missing}
                  today={today}
                  bankReadAt={bankReadAt}
                  curve={balance.curve}
                  noData={balance.noData}
                  isCurrent={isCurrent}
                />
              </HomeSection>
            ) : (
              data.latest !== null && (
                <HomeSection id="balance" headingId="balance-heading" title={tm("balance")}>
                  <BalancePrompt />
                </HomeSection>
              )
            )}
            <HomeSection headingId="further-heading" title={tm("further")} flush>
              <ul className="divide-y">
                <li>
                  <RowLink
                    href="/recurring"
                    title={t("recurring.title")}
                    icon={<Repeat />}
                    hint={
                      data.recurringCount === 0
                        ? t("recurring.none")
                        : data.recurringToConfirm > 0
                          ? t("recurring.hintWithDetected", {
                              amount: formatWholeCents(data.recurringPerMonthCents, locale),
                              count: data.recurringToConfirm,
                            })
                          : t("recurring.hint", { amount: formatWholeCents(data.recurringPerMonthCents, locale) })
                    }
                  />
                </li>
                <li>
                  <RowLink
                    href="/budget/next-month"
                    title={t("nextMonth.title")}
                    icon={<CalendarRange />}
                    hint={
                      data.nextMonth.entries.length === 0
                        ? t("nextMonth.empty", { month: nextMonthLabel })
                        : t("nextMonth.hint", { month: nextMonthLabel, amount: formatSignedWholeCents(data.nextMonthLeftCents, locale) })
                    }
                  />
                </li>
                <li>
                  <RowLink href="/year" title={t("year.title")} hint={t("year.hint", { year: data.year })} icon={<ChartColumn />} />
                </li>
              </ul>
            </HomeSection>
          </div>
        </div>
      </main>
    </div>
  );
}

/** The detail card's rows; the bucket filed on the parent itself gets the breakdown page's label. */
function subcategorySlices(
  buckets: SubcategorySpending[] | undefined,
  parentItselfLabel: (name: string) => string,
): SubcategorySlice[] | undefined {
  return buckets?.map((b) => ({
    key: b.categoryId,
    name: b.isParentItself ? parentItselfLabel(b.name) : b.name,
    color: b.color,
    icon: b.icon,
    spentCents: b.spentCents,
  }));
}
