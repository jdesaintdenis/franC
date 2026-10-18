"use client";

import { useLocale, useTranslations } from "next-intl";

import { isUnderOnePercent } from "@/lib/dashboard/shares";
import { formatPercent } from "@/lib/money";

/** "32%", or "<1%" for a non-zero amount whose whole-percent share is 0. */
export function useShareLabel() {
  const locale = useLocale();
  const t = useTranslations("dashboard.categorySpending");
  return (cents: number, share: number) =>
    isUnderOnePercent(cents, share)
      ? t("underOnePercent", { percent: formatPercent(1, locale) })
      : formatPercent(share, locale);
}
