import { useLocale, useTranslations } from "next-intl";

import { formatSignedCents, formatSignedWholeCents } from "@/lib/money";

/** A regular payment's amount: exact, or "about +€2,850" for a tracked one (median of its last payments). */
export function ExpectedAmount({ cents, tracked }: { cents: number; tracked: boolean }) {
  const locale = useLocale();
  const t = useTranslations("common");
  return <>{tracked ? t("about", { amount: formatSignedWholeCents(cents, locale) }) : formatSignedCents(cents, locale)}</>;
}
