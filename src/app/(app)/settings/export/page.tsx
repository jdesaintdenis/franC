import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { requireUser } from "@/lib/auth/session";

const FILES = ["transactions", "categories", "rules", "budgets"] as const;

export default async function ExportPage() {
  await requireUser();
  const nav = await getTranslations("common.nav");
  const t = await getTranslations("settings");

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-4 md:px-8">
      <PageHeader title={<PageTitle>{t("export.title")}</PageTitle>} back={{ href: "/settings", label: nav("backToMore") }} />
      <p className="text-muted-foreground text-sm">{t("export.intro")}</p>
      <ul aria-label={t("export.listLabel")} className="divide-y rounded-lg border">
        {FILES.map((kind) => (
          <li key={kind}>
            {/* A file download, so a plain anchor: next/link would try a client navigation. */}
            <a
              href={`/api/export/${kind}`}
              download
              className="hover:bg-accent flex min-h-14 flex-col justify-center px-4 py-2"
            >
              <span className="font-medium">{t(`export.${kind}.title`)}</span>
              <span className="text-muted-foreground text-sm">{t(`export.${kind}.hint`)}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-sm">
        {t.rich("export.filtered", {
          link: (chunks) => (
            <Link href="/transactions" className="text-primary underline underline-offset-4">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </main>
    </div>
  );
}
