"use client";

import { useLocale, useTranslations } from "next-intl";

import { formatWholeCents } from "@/lib/money";
import type { RegularTotals } from "@/lib/recurring/list-view";

/**
 * What fixed costs add up to, confirmed ones only: monthly in big type, then the yearly figure,
 * the count and the income. Detected payments are still guesses; the "À confirmer" block holds them.
 */
export function RegularHeadline({ totals }: { totals: RegularTotals }) {
  const locale = useLocale();
  const t = useTranslations("recurring");
  const hasOutflows = totals.confirmedYearlyOutCents > 0;

  return (
    <section
      aria-label={t("headline.label")}
      className="bg-card flex flex-col gap-1 rounded-lg border p-3.5"
    >
      {hasOutflows ? (
        <>
          <p className="text-muted-foreground text-sm">
            {t.rich("headline.confirmedPerMonth", {
              amount: formatWholeCents(totals.confirmedMonthlyOutCents, locale),
              big: (chunks) => (
                <span className="text-foreground text-[28px] leading-none font-extrabold tabular-nums">
                  {chunks}
                </span>
              ),
            })}
          </p>
          <p className="text-muted-foreground text-xs tabular-nums">
            {t("headline.confirmedDetail", {
              yearly: formatWholeCents(totals.confirmedYearlyOutCents, locale),
              count: totals.confirmedOutCount,
            })}
            {totals.confirmedMonthlyInCents > 0 &&
              t("headline.income", {
                amount: formatWholeCents(
                  totals.confirmedMonthlyInCents,
                  locale,
                ),
              })}
          </p>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          {t(
            totals.toConfirmCount > 0
              ? "headline.noneConfirmed"
              : "headline.none",
          )}
        </p>
      )}
    </section>
  );
}
