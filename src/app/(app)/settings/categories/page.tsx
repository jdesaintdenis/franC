import { getLocale, getTranslations } from "next-intl/server";

import { BottomAddButton } from "@/components/manage/bottom-add-button";
import { PageHeader } from "@/components/page-header";
import { listBudgets } from "@/db/queries/budgets";
import {
  getCategoryMonthSpending,
  listCategories,
} from "@/db/queries/categories";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { buildCategoryTree } from "@/lib/categorize/hierarchy";
import { nextCategoryColor } from "@/lib/category-color";
import { currentMonth } from "@/lib/dashboard/month";

import { CategoryList } from "./category-list";

export default async function CategoriesPage() {
  const user = await requireUser();
  const nav = await getTranslations("common.nav");
  const [categories, spending, budgets, locale, t] = await Promise.all([
    listCategories(user.id),
    getCategoryMonthSpending(db, user.id, currentMonth(new Date())),
    listBudgets(db, user.id),
    getLocale(),
    getTranslations("settings"),
  ]);
  const tree = buildCategoryTree(categories, locale).map(
    ({ category, children }) => ({
      category: toItem(category),
      children: children.map(toItem),
    }),
  );

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 pb-4 md:px-8">
        <PageHeader
          title={
            <span className="font-title text-[22px] font-bold tracking-[0.1em] uppercase">
              {t("categories.title")}
            </span>
          }
          back={{ href: "/settings", label: nav("backToMore") }}
        />
        {categories.length > 0 && (
          <p className="text-muted-foreground px-1 text-sm">
            {t("categories.lead", { count: categories.length })}
          </p>
        )}
        <CategoryList
          tree={tree}
          spending={spending}
          budgeted={budgets.map((b) => b.categoryId)}
          defaultColor={nextCategoryColor(
            tree.map(({ category }) => category.color),
          )}
        />
        {tree.length > 0 && (
          <BottomAddButton label={t("categories.addLabel")} />
        )}
      </main>
    </div>
  );
}

function toItem(c: {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  parentId: string | null;
}) {
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    icon: c.icon,
    parentId: c.parentId,
  };
}
