import { Landmark } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/db/client";
import { listBankMappings } from "@/db/queries/bank-categories";
import { listCategoryOptions } from "@/db/queries/categories";
import { requireUser } from "@/lib/auth/session";
import { groupBankMappings } from "@/lib/categorize/bank-groups";

import { MappingRow } from "./mapping-row";

export default async function BankCategoriesPage() {
  const user = await requireUser();
  const nav = await getTranslations("common.nav");
  const locale = await getLocale();
  const [mappings, options, t] = await Promise.all([
    listBankMappings(db, user.id),
    listCategoryOptions(user.id, locale),
    getTranslations("settings"),
  ]);
  const categories = options.map((c) => ({ id: c.id, label: c.label }));
  const groups = groupBankMappings(mappings);

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-4 md:px-8">
      <PageHeader title={<PageTitle>{t("bankCategories.title")}</PageTitle>} back={{ href: "/settings", label: nav("backToMore") }} />
      <p className="text-muted-foreground text-sm">{t("bankCategories.intro")}</p>
      {groups.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title={t("bankCategories.empty.title")}
          body={t("bankCategories.empty.body")}
          action={
            <Link href="/import" className={buttonVariants({ className: "h-11" })}>
              {t("bankCategories.empty.action")}
            </Link>
          }
        />
      ) : (
        <ul aria-label={t("bankCategories.listLabel")} className="divide-y rounded-lg border">
          {groups.map((group) => (
            <li key={group.bankCategory}>
              {group.own ? (
                <MappingRow
                  mapping={{
                    id: group.own.id,
                    name: group.bankCategory,
                    displayName: group.bankCategory,
                    categoryId: group.own.categoryId,
                  }}
                  categories={categories}
                  indented={false}
                />
              ) : (
                <p className="px-3 pt-3 font-medium break-words">{group.bankCategory}</p>
              )}
              {group.subcategories.length > 0 && (
                <ul
                  aria-label={t("bankCategories.subLabel", { name: group.bankCategory })}
                  className="divide-y border-t"
                >
                  {group.subcategories.map((sub) => (
                    <li key={sub.id}>
                      <MappingRow
                        mapping={{
                          id: sub.id,
                          name: `${group.bankCategory} > ${sub.bankSubcategory}`,
                          displayName: sub.bankSubcategory ?? "",
                          categoryId: sub.categoryId,
                        }}
                        categories={categories}
                        indented
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
    </div>
  );
}
