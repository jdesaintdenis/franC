import { getLocale, getTranslations } from "next-intl/server";

import { BottomAddButton } from "@/components/manage/bottom-add-button";
import { NoCategoriesHint } from "@/components/no-categories-hint";
import { PageHeader } from "@/components/page-header";
import { db } from "@/db/client";
import { getBudgetPresets, listBudgets } from "@/db/queries/budgets";
import { listCategories } from "@/db/queries/categories";
import { requireUser } from "@/lib/auth/session";
import { buildSuggestionGroups, topSuggestions } from "@/lib/budgets/suggestions";
import { formatWholeCents } from "@/lib/money";

import { HomeSection } from "../../home/home-section";
import { loadPlan } from "../../budget/plan-data";
import { BudgetsScreen } from "./budgets-screen";

const TOP_SUGGESTIONS = 3;

export default async function BudgetsPage() {
  const user = await requireUser();
  const nav = await getTranslations("common.nav");
  const [plan, categories, budgets, locale, t, tDash] = await Promise.all([
    // The same numbers and pace as the Plan tab, so the two never disagree.
    loadPlan(user.id, new Date()),
    listCategories(user.id),
    listBudgets(db, user.id),
    getLocale(),
    getTranslations("settings.budgets"),
    getTranslations("dashboard.budgets"),
  ]);
  const presets = await getBudgetPresets(db, user.id, plan.month);
  const { budgets: overview } = plan;
  const count = overview.items.reduce((n, item) => n + 1 + item.children.length, 0);

  const suggestionInput = {
    categories,
    budgetedIds: new Set(budgets.map((b) => b.categoryId)),
    averages: new Map([...presets].map(([id, p]) => [id, p.averageCents])),
    locale,
  };
  const [day, daysInMonth] = [Number(plan.today.slice(8, 10)), plan.daysLeft + Number(plan.today.slice(8, 10))];

  const list = (
    <BudgetsScreen
      items={overview.items}
      rollovers={Object.fromEntries(budgets.map((b) => [b.categoryId, b.rollover]))}
      categories={categories.map((c) => ({ id: c.id, name: c.name, color: c.color, icon: c.icon, parentId: c.parentId }))}
      presets={Object.fromEntries(presets)}
      chargePresets={plan.chargePresets}
      groups={buildSuggestionGroups(suggestionInput)}
      top={topSuggestions({ ...suggestionInput, limit: TOP_SUGGESTIONS })}
      month={plan.month}
      pace={{ day, daysInMonth }}
    />
  );

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 pb-4 md:px-8">
        <PageHeader
          title={<span className="font-title text-[22px] font-bold tracking-[0.1em] uppercase">{t("title")}</span>}
          back={{ href: "/budget", label: nav("backToPlan") }}
        />
        {categories.length === 0 ? (
          <NoCategoriesHint />
        ) : (
          <>
            {overview.items.length > 0 && (
              <div className="bg-card flex flex-col gap-1.5 rounded-lg border p-3.5">
                <p className="text-muted-foreground text-sm tabular-nums">
                  {t.rich("summary", {
                    amount: formatWholeCents(overview.totals.budgetedCents, locale),
                    count,
                    big: (chunks) => <span className="text-foreground text-[28px] leading-none font-extrabold">{chunks}</span>,
                  })}
                </p>
                <p className="text-muted-foreground text-[11px]">
                  {tDash(overview.items.some((i) => (i.charges ?? []).length > 0) ? "legendCharges" : "legend")}
                </p>
              </div>
            )}
            {overview.items.length > 0 ? <HomeSection headingId="budgets-month" title={t("monthTitle")}>{list}</HomeSection> : list}
            {overview.items.length > 0 && <p className="text-muted-foreground px-1 text-xs">{t("footnote")}</p>}
          </>
        )}
        {categories.length > 0 && overview.items.length > 0 && <BottomAddButton label={t("addLabel")} />}
      </main>
    </div>
  );
}
