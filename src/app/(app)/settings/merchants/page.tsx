import { getTranslations } from "next-intl/server";

import { AddButton } from "@/components/manage/add-button";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { db } from "@/db/client";
import { listMerchants } from "@/db/queries/merchants";
import { requireUser } from "@/lib/auth/session";

import { MerchantsScreen } from "./merchants-screen";

export default async function MerchantsPage() {
  const user = await requireUser();
  const nav = await getTranslations("common.nav");
  const [merchants, t] = await Promise.all([listMerchants(db, user.id), getTranslations("settings")]);

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-4 md:px-8">
      <PageHeader
        title={<PageTitle>{t("merchants.title")}</PageTitle>}
        back={{ href: "/settings", label: nav("backToMore") }}
        action={<AddButton label={t("merchants.add")} />}
      />
      <p className="text-muted-foreground text-sm">{t("merchants.intro")}</p>
      <MerchantsScreen
        merchants={merchants.map((m) => ({
          id: m.id,
          name: m.name,
          transactionCount: m.transactionCount,
          patterns: m.patterns.map((p) => ({ id: p.id, matchType: p.matchType, pattern: p.pattern })),
        }))}
      />
    </main>
    </div>
  );
}
