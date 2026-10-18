import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("auth.shell.notFound");

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground max-w-sm">{t("description")}</p>
        <Link
          href="/"
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 inline-flex h-10 items-center rounded-md px-4 text-sm font-medium"
        >
          {t("home")}
        </Link>
      </main>
    </div>
  );
}
