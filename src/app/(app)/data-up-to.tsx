import { getLocale, getTranslations } from "next-intl/server";

import { formatShortDay } from "@/lib/format-date";
import type { AccountFreshness } from "@/lib/import-reminder/staleness";
import { dataUpTo, laggingAccounts } from "@/lib/import-reminder/staleness";

/**
 * The page header's small caption: how fresh the numbers are. A span, because the header wraps it in a paragraph. With several accounts and no
 * filter it also names the accounts that lag behind the newest one.
 */
export async function DataUpTo({
  accounts,
  today,
  listLagging,
}: {
  /** The accounts in scope (the filtered one, or all). */
  accounts: AccountFreshness[];
  /** "YYYY-MM-DD" in Europe/Paris. */
  today: string;
  listLagging: boolean;
}) {
  const newest = dataUpTo(accounts);
  if (newest === null) return null;
  const [t, locale] = await Promise.all([getTranslations("dashboard.dataUpTo"), getLocale()]);
  const fmt = (iso: string) => formatShortDay(iso, today, locale);
  const date = newest === today ? t("today") : fmt(newest);
  const lagging = listLagging
    ? laggingAccounts(accounts).map((a) => t("lagging", { name: a.name, date: fmt(a.latestDate ?? "") }))
    : [];
  return (
    <span data-testid="data-up-to">
      {lagging.length > 0 ? t("withLagging", { date, lagging: lagging.join(", ") }) : t("text", { date })}
    </span>
  );
}
