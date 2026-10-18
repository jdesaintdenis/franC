import { getLocale, getTranslations } from "next-intl/server";

import { asLocale } from "@/i18n/config";
import type { AccountTotals } from "@/lib/accounts/totals";
import { formatCents } from "@/lib/money";

/** What is on all the accounts, in the 50 F value panel: the sum, then current and savings apart when both exist. */
export async function AccountsTotal({ totals }: { totals: AccountTotals }) {
  if (totals.totalCents === null) return null;
  const [t, rawLocale] = await Promise.all([getTranslations("settings.accounts.total"), getLocale()]);
  const locale = asLocale(rawLocale);
  const current = formatCents(totals.currentCents, locale);
  const savings = formatCents(totals.savingsCents, locale);
  const split =
    totals.hasCurrent && totals.hasSavings
      ? t("split", { current, savings })
      : totals.hasSavings
        ? t("savings", { savings })
        : null;

  return (
    <section
      aria-labelledby="accounts-total-label"
      className="hero-50f flex flex-col gap-1.5 rounded-lg p-4"
      data-testid="accounts-total"
    >
      <span id="accounts-total-label" className="text-muted-foreground text-xs">
        {t("label")}
      </span>
      <span className="text-[30px] leading-none font-extrabold tabular-nums">
        {formatCents(totals.totalCents, locale)}
      </span>
      {split && <span className="text-muted-foreground text-xs">{split}</span>}
    </section>
  );
}
