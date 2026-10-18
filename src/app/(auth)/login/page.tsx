import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { safeNextPath } from "@/lib/auth/safe-next-path";

import { login } from "../actions";
import { AuthForm } from "../auth-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNextPath((await searchParams).next);
  const t = await getTranslations("auth.login");

  return (
    <Card>
      <CardHeader>
        {/* CardTitle renders a div; the page needs a real h1. */}
        <h1 data-slot="card-title" className="text-xl leading-none font-semibold">
          {t("title")}
        </h1>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AuthForm mode="login" action={login} next={next} submitLabel={t("submit")} pendingLabel={t("pending")} />
        <p className="text-muted-foreground text-center text-sm">
          {t.rich("noAccount", {
            link: (chunks) => (
              <Link href="/signup" className="text-foreground underline underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </CardContent>
    </Card>
  );
}
