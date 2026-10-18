import { CalendarDays } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { formatMonthLabel } from "@/lib/dashboard/month";
import { formatCents, formatWholeCents } from "@/lib/money";

import { CategoryTile } from "@/components/category-tile";
import { HomeSection } from "../../home/home-section";
import { ForecastList } from "./forecast-list";
import { loadNextMonth } from "./next-month-data";
import { OutlookCard } from "./outlook-card";
import { ToConfirmRow } from "./to-confirm-row";

/** What is expected next month: what it should leave, then the payments, income and budgets behind it. */
export default async function NextMonthPage() {
  const [user, locale, t, nav] = await Promise.all([
    requireUser(),
    getLocale(),
    getTranslations("plan.nextMonthPage"),
    getTranslations("common.nav"),
  ]);
  const data = await loadNextMonth(user.id, new Date());
  const { forecast, outlook, budgets, categories, today } = data;
  const payments = forecast.entries.filter((e) => e.amountCents < 0);
  const income = forecast.entries.filter((e) => e.amountCents > 0);
  const empty = forecast.entries.length === 0;

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 pb-6 md:px-8 lg:max-w-5xl">
        <PageHeader
          eyebrow={t("eyebrow")}
          title={<PageTitle>{formatMonthLabel(data.month, locale)}</PageTitle>}
          back={{ href: "/budget", label: nav("backToPlan") }}
        />
        {empty ? (
          <EmptyState
            icon={CalendarDays}
            title={t("empty.title")}
            body={t("empty.body")}
            action={
              <Link href="/recurring" className={buttonVariants({ className: "h-11" })}>
                {t("empty.action")}
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6">
            <div className="flex flex-col gap-2">
              <HomeSection headingId="left-heading" title={t("leftTitle")}>
                <OutlookCard outlook={outlook} hasBudgets={budgets.length > 0} dataUpTo={data.dataUpTo} today={today} />
              </HomeSection>
              {forecast.summary.detectedCount > 0 && <ToConfirmRow count={forecast.summary.detectedCount} />}
              {budgets.length > 0 && (
                <HomeSection headingId="budgets-heading" title={t("budgetsTitle")} link={{ href: "/settings/budgets", label: t("edit") }} flush>
                  <ul className="divide-border divide-y">
                    {budgets.map((b) => (
                      <li key={b.categoryId} className="grid min-h-14 grid-cols-[32px_1fr_auto] items-center gap-2.5 px-3.5 py-2">
                        <CategoryTile icon={b.icon} color={b.color} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-semibold">{b.name}</span>
                          <span className="text-muted-foreground text-xs">{t("perMonth")}</span>
                        </span>
                        <span className="font-semibold tabular-nums">{formatCents(-b.budgetCents, locale)}</span>
                      </li>
                    ))}
                  </ul>
                </HomeSection>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {payments.length > 0 && (
                <HomeSection
                  headingId="payments-heading"
                  title={t("paymentsTitle")}
                  note={formatWholeCents(-forecast.summary.all.outCents, locale)}
                  flush
                >
                  <ForecastList label={t("paymentsTitle")} entries={payments} categories={categories} today={today} />
                </HomeSection>
              )}
              {income.length > 0 && (
                <HomeSection
                  headingId="income-heading"
                  title={t("incomeTitle")}
                  note={formatWholeCents(forecast.summary.all.inCents, locale)}
                  flush
                >
                  <ForecastList label={t("incomeTitle")} entries={income} categories={categories} today={today} />
                </HomeSection>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
