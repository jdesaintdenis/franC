import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

import { signup } from "../actions";
import { AuthForm } from "../auth-form";

export default async function SignupPage() {
  const t = await getTranslations("auth.signup");

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
        <AuthForm mode="signup" action={signup} submitLabel={t("submit")} pendingLabel={t("pending")} />
        <p className="text-muted-foreground text-center text-sm">
          {t.rich("haveAccount", {
            link: (chunks) => (
              <Link href="/login" className="text-foreground underline underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </CardContent>
    </Card>
  );
}
