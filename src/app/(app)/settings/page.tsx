import { Building2, ChevronRight, Download, ListChecks, Store, Tag, Tags, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { HomeSection } from "@/app/(app)/home/home-section";
import { PageHeader } from "@/components/page-header";
import { db } from "@/db/client";
import { getManageCounts } from "@/db/queries/manage-counts";
import { getIncomeMonth, getUserLocale } from "@/db/queries/users";
import { isLocale } from "@/i18n/config";
import { requireUser } from "@/lib/auth/session";

import { IncomeMonthRow } from "./income-month-row";
import { LanguageRow } from "./language-row";
import { SignOutButton } from "./sign-out-button";

/** One 52 px row: icon tile, name, a short value on the right, chevron. */
function PlusRow({ href, title, value, icon: Icon }: { href: string; title: string; value?: ReactNode; icon: LucideIcon }) {
  return (
    <li>
      <Link
        href={href}
        className="hover:bg-muted/60 active:bg-muted focus-visible:ring-ring/50 flex min-h-[52px] items-center gap-3 px-3.5 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
      >
        <span aria-hidden="true" className="bg-muted text-primary flex size-8 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-[18px]">
          <Icon />
        </span>
        <span className="min-w-0 flex-1 font-semibold">{title}</span>
        {value ? <span className="text-muted-foreground text-[13px]">{value}</span> : null}
        <ChevronRight className="text-muted-foreground size-[18px] shrink-0" aria-hidden="true" />
      </Link>
    </li>
  );
}

/** Plus: the sorting lists, the export, the language and the sign-out. Accounts, bank sync and imports live in the Comptes tab. */
export default async function SettingsPage() {
  const user = await requireUser();
  const t = await getTranslations("settings");
  const [counts, saved, incomeMonth] = await Promise.all([getManageCounts(db, user.id), getUserLocale(user.id), getIncomeMonth(user.id)]);

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 pb-6 md:px-8">
        <PageHeader title={<span className="font-title text-[22px] font-bold tracking-[0.1em] uppercase">{t("title")}</span>} />
        <HomeSection headingId="sorting-heading" title={t("sections.classement")} flush>
          <ul className="divide-border divide-y">
            <PlusRow
              href="/settings/categories"
              icon={Tags}
              title={t("sections.categories.title")}
              value={
                counts.subCategories > 0
                  ? t("sections.values.categories", { top: counts.topCategories, sub: counts.subCategories })
                  : t("sections.values.categoriesTop", { top: counts.topCategories })
              }
            />
            <PlusRow href="/settings/rules" icon={ListChecks} title={t("sections.rules.title")} value={counts.rules} />
            <PlusRow href="/settings/merchants" icon={Store} title={t("sections.merchants.title")} value={counts.merchants} />
            <PlusRow href="/settings/tags" icon={Tag} title={t("sections.tags.title")} value={counts.tags} />
            <PlusRow
              href="/settings/bank-categories"
              icon={Building2}
              title={t("sections.bankCategories.title")}
              value={counts.bankMappings > 0 ? t("sections.values.bankMappings", { count: counts.bankMappings }) : undefined}
            />
          </ul>
        </HomeSection>
        <HomeSection headingId="data-heading" title={t("sections.data")} flush>
          <ul>
            <PlusRow href="/settings/export" icon={Download} title={t("sections.export.title")} value={t("sections.values.csv")} />
          </ul>
        </HomeSection>
        <HomeSection headingId="preferences-heading" title={t("sections.preferences")} flush>
          <LanguageRow current={isLocale(saved) ? saved : "auto"} />
          <IncomeMonthRow current={incomeMonth} />
        </HomeSection>
        <HomeSection headingId="account-heading" title={t("sections.account")} flush>
          <div className="flex min-h-[52px] items-center justify-between gap-3 px-3.5">
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-[13px]">{user.email}</span>
            <SignOutButton />
          </div>
        </HomeSection>
      </main>
    </div>
  );
}
