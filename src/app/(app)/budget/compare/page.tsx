import { CalendarDays } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/session";
import { monthNames, parseCompareParams } from "@/lib/compare/months";
import { currentMonth, dashboardHref } from "@/lib/dashboard/month";

import { HomeSection } from "../../home/home-section";
import { loadCompare } from "./compare-data";
import { ComparePills } from "./compare-pills";
import { CompareBudgets, CompareCategories, CompareLegend, CompareSummary } from "./compare-sections";

/**
 * Two months side by side (`?a=` and `?b=`): what changed in total, per category and per budget,
 * with the Budget page's own figures (SPEC §89).
 */
export default async function ComparePage({ searchParams }: PageProps<"/budget/compare">) {
  const [user, locale, t, nav, glossary] = await Promise.all([
    requireUser(),
    getLocale(),
    getTranslations("plan.compare"),
    getTranslations("common.nav"),
    getTranslations("common.glossary"),
  ]);
  const now = new Date();
  const months = parseCompareParams(await searchParams, currentMonth(now));
  const data = await loadCompare(user.id, now, months);
  const names = monthNames(months, locale);
  const hasData = data.totals.a.count > 0 || data.totals.b.count > 0;
  const inProgress = months.a === data.current ? names.a.sentence : months.b === data.current ? names.b.sentence : null;

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 pb-6 md:px-8">
        <PageHeader
          title={<span className="font-title text-[22px] font-bold tracking-[0.1em] uppercase">{t("title")}</span>}
          back={{ href: dashboardHref({ month: months.a === data.current ? null : months.a }), label: nav("backToPlan") }}
        />
        <ComparePills months={months} current={data.current} history={data.history} />
        {hasData ? (
          <>
            <HomeSection headingId="compare-summary-heading" title={t("summary")} testId="compare-summary">
              <CompareSummary totals={data.totals} names={names} inProgress={inProgress} />
            </HomeSection>
            {data.categories.length > 0 && (
              <HomeSection headingId="compare-categories-heading" title={t("categories")} aside={<CompareLegend names={names} />} testId="compare-categories">
                <CompareCategories rows={data.categories} month={months.a} names={names} uncategorized={glossary("uncategorized")} />
              </HomeSection>
            )}
            {data.budgets.length > 0 && (
              <HomeSection headingId="compare-budgets-heading" title={t("budgets")} testId="compare-budgets">
                <CompareBudgets budgets={data.budgets} />
              </HomeSection>
            )}
          </>
        ) : (
          <EmptyState icon={CalendarDays} title={t("empty", { monthA: names.a.sentence, monthB: names.b.sentence })} body={t("emptyBody")} />
        )}
      </main>
    </div>
  );
}
