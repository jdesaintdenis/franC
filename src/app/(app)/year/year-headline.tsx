import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";

import type { Locale } from "@/i18n/config";
import { dashboardHref, formatMonthName } from "@/lib/dashboard/month";
import { formatPercent, formatWholeCents } from "@/lib/money";
import { yearHeadline } from "@/lib/year/headline";
import type { MonthHighlight, MonthHighlights } from "@/lib/year/highlights";
import { cn } from "@/lib/utils";

function Column({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border flex min-w-0 flex-col gap-0.5 border-l px-2.5 first:border-0 first:pl-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-[15px] font-bold tabular-nums">{value}</dd>
    </div>
  );
}

// A month name inside a sentence: lower case in French ("mars"), capitalized in English.
function monthInSentence(month: string, locale: Locale): string {
  const name = formatMonthName(month, locale);
  return locale === "fr" ? name.toLocaleLowerCase("fr") : name;
}

function HighlightLine({ kind, highlight }: { kind: "best" | "toughest" | "lowest"; highlight: MonthHighlight }) {
  const locale = useLocale();
  const t = useTranslations("year.highlights");
  return (
    <li>
      {t.rich(kind, {
        month: monthInSentence(highlight.month, locale),
        amount: formatWholeCents(Math.abs(highlight.savedCents), locale),
        link: (chunks: ReactNode) => (
          <Link href={dashboardHref({ month: highlight.month })} className="text-primary inline-flex min-h-6 items-center font-semibold">
            {chunks}
          </Link>
        ),
      })}
    </li>
  );
}

/** The year in one figure: what was saved (or overspent), the totals it comes from, and the best and toughest months. */
export function YearHeadline({
  year,
  currentYear,
  incomeCents,
  spentCents,
  perMonthCents,
  highlights,
}: {
  year: number;
  currentYear: number;
  incomeCents: number;
  spentCents: number;
  /** The year's spending averaged over the months it covers. */
  perMonthCents: number;
  highlights: MonthHighlights | null;
}) {
  const locale = useLocale();
  const t = useTranslations("year.headline");
  const glossary = useTranslations("common.glossary");
  const headline = yearHeadline(incomeCents, spentCents);

  let label: string;
  let note: string | null = null;
  switch (headline.kind) {
    case "saved":
      label = year === currentYear ? t("savedSoFarLabel") : t("savedLabel", { year });
      note = headline.ratePercent === null ? null : t("savedRate", { rate: formatPercent(headline.ratePercent, locale) });
      break;
    case "overspent":
      label = t("overspentLabel", { year });
      note = t("overspentNote");
      break;
    case "even":
      label = t("evenLabel", { year });
      break;
    case "noIncome":
      label = t("noIncomeLabel", { year });
      note = t("noIncomeNote", { year });
      break;
  }

  const lowestIsNegative = highlights !== null && highlights.worst.savedCents < 0;
  return (
    <section aria-label={t("label")} className="flex flex-col gap-2.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={cn(
          "text-[34px] leading-tight font-extrabold tabular-nums",
          headline.kind === "saved" && "text-positive",
          headline.kind === "overspent" && "text-warning",
        )}
      >
        {formatWholeCents(headline.amountCents, locale)}
      </p>
      {note !== null && <p className="text-muted-foreground -mt-1.5 text-[13px]">{note}</p>}
      <dl className="border-border grid grid-cols-3 border-t pt-2.5">
        <Column label={glossary("income")} value={formatWholeCents(incomeCents, locale)} />
        <Column label={glossary("spent")} value={formatWholeCents(spentCents, locale)} />
        <Column label={t("perMonth")} value={formatWholeCents(perMonthCents, locale)} />
      </dl>
      {highlights !== null && (
        <ul className="border-border flex flex-col gap-1 border-t pt-2.5 text-[13px]">
          <HighlightLine kind="best" highlight={highlights.best} />
          <HighlightLine kind={lowestIsNegative ? "toughest" : "lowest"} highlight={highlights.worst} />
        </ul>
      )}
    </section>
  );
}
