import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { db } from "@/db/client";
import { listTags } from "@/db/queries/tags";
import { requireUser } from "@/lib/auth/session";

import { TagList } from "./tag-list";

export default async function TagsPage() {
  const user = await requireUser();
  const nav = await getTranslations("common.nav");
  const [tags, t] = await Promise.all([listTags(db, user.id), getTranslations("settings")]);

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-4 md:px-8">
      <PageHeader title={<PageTitle>{t("tags.title")}</PageTitle>} back={{ href: "/settings", label: nav("backToMore") }} />
      <p className="text-muted-foreground text-sm">{t("tags.intro")}</p>
      <TagList tags={tags} />
    </main>
    </div>
  );
}
