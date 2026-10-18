"use client";

import { useTranslations } from "next-intl";

import { ErrorFallback } from "@/components/error-fallback";

export default function AuthError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("common.errors");
  return <ErrorFallback error={error} retry={retry} fallbackMessage={t("generic")} />;
}
