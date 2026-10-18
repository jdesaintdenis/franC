import { getLocale, getTranslations } from "next-intl/server";

import { AddButton } from "@/components/manage/add-button";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { db } from "@/db/client";
import { listCategoryOptions } from "@/db/queries/categories";
import { listRules } from "@/db/queries/category-rules";
import { listRuleSuggestions } from "@/db/queries/guess";
import { requireUser } from "@/lib/auth/session";
import { CATEGORY_PATH_SEPARATOR } from "@/lib/categorize/hierarchy";

import { ApplyRulesButton } from "./apply-rules-button";
import { RuleList } from "./rule-list";
import { SuggestedRules } from "./suggested-rules";

export default async function RulesPage() {
  const user = await requireUser();
  const nav = await getTranslations("common.nav");
  const locale = await getLocale();
  const [rules, categories, suggestions] = await Promise.all([
    listRules(db, user.id),
    listCategoryOptions(user.id, locale),
    listRuleSuggestions(db, user.id),
  ]);
  const t = await getTranslations("settings");
  const categoryOptions = categories.map((c) => ({ id: c.id, label: c.label }));

  // The pill draws the icon itself, so its label is the plain path without emojis.
  const pathById = new Map(
    categories.map((c) => [c.id, c.parentName ? `${c.parentName}${CATEGORY_PATH_SEPARATOR}${c.name}` : c.name]),
  );

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-4 md:px-8">
      <PageHeader
        title={<PageTitle>{t("rules.title")}</PageTitle>}
        back={{ href: "/settings", label: nav("backToMore") }}
        action={<AddButton label={t("rules.addLabel")} />}
      />
      <p className="text-muted-foreground text-sm">
        {t("rules.intro")}
      </p>
      <SuggestedRules suggestions={suggestions} />
      {rules.length > 0 && <ApplyRulesButton />}
      <RuleList
        rules={rules.map((r) => ({
          id: r.id,
          categoryId: r.categoryId,
          categoryName: r.categoryName,
          categoryLabel: pathById.get(r.categoryId) ?? r.categoryName,
          categoryColor: r.categoryColor,
          categoryIcon: r.categoryIcon,
          matchType: r.matchType,
          pattern: r.pattern,
        }))}
        categories={categoryOptions}
      />
    </main>
    </div>
  );
}
