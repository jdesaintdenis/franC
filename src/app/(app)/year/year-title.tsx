import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { yearHref } from "./hrefs";

const ARROW =
  "bg-secondary hover:bg-muted focus-visible:ring-ring/50 flex size-11 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-[3px]";

/**
 * ‹ 2026 › under the page title. The arrows are plain links, so stepping works without JS; the
 * previous one stops at the first year with data and the next one at the current year.
 */
export function YearTitle({ year, currentYear, firstYear }: { year: number; currentYear: number; firstYear: number | null }) {
  const t = useTranslations("year.selector");
  const canGoBack = firstYear !== null && year > firstYear;
  const canGoForward = year < currentYear;
  const disabled = (label: string, icon: React.ReactNode) => (
    <span aria-disabled="true" aria-label={label} role="link" className={cn(ARROW, "opacity-35")}>
      {icon}
    </span>
  );
  return (
    <div className="bg-card grid grid-cols-[44px_1fr_44px] items-center gap-1.5 rounded-lg border p-1">
      {canGoBack ? (
        <Link href={yearHref({ year: year - 1 })} aria-label={t("previous")} className={ARROW}>
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>
      ) : (
        disabled(t("previous"), <ChevronLeft className="size-5" aria-hidden="true" />)
      )}
      <div className="flex items-center justify-center gap-2">
        <h2 className="text-[15px] font-bold tabular-nums" aria-live="polite">
          {year}
        </h2>
        {year === currentYear && <span className="bg-secondary rounded-full px-2.5 py-0.5 text-xs font-bold">{t("current")}</span>}
      </div>
      {canGoForward ? (
        <Link href={yearHref({ year: year + 1 === currentYear ? null : year + 1 })} aria-label={t("next")} className={ARROW}>
          <ChevronRight className="size-5" aria-hidden="true" />
        </Link>
      ) : (
        disabled(t("next"), <ChevronRight className="size-5" aria-hidden="true" />)
      )}
    </div>
  );
}
