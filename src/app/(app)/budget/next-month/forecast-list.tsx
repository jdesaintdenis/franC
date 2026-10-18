import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { CategoryTile } from "@/components/category-tile";
import { ExpectedAmount } from "@/components/expected-amount";
import { formatDay } from "@/lib/format-date";
import type { ForecastEntry } from "@/lib/recurring/forecast";
import { cn } from "@/lib/utils";

export type CategoryLook = { name: string; color: string; icon: string | null };

/** The month's projected payments (or income) in date order; each row opens its item on Regular payments. */
export function ForecastList({
  label,
  entries,
  categories,
  today,
}: {
  /** The list's accessible name. */
  label: string;
  entries: ForecastEntry[];
  categories: ReadonlyMap<string, CategoryLook>;
  /** "YYYY-MM-DD" in Europe/Paris. */
  today: string;
}) {
  const locale = useLocale();
  const t = useTranslations("plan.nextMonthPage");
  return (
    <ul aria-label={label} className="divide-border divide-y">
      {entries.map((entry) => {
        const category = entry.categoryId ? categories.get(entry.categoryId) : undefined;
        const detail = [formatDay(entry.date, today, locale), category?.name].filter(Boolean).join(" · ");
        return (
          <li key={`${entry.id}-${entry.date}`}>
            <Link
              href={`/recurring?item=${entry.id}`}
              className="hover:bg-muted/60 focus-visible:ring-ring/50 grid min-h-14 grid-cols-[32px_1fr_auto] items-center gap-2.5 px-3.5 py-2 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
            >
              <CategoryTile icon={category?.icon ?? null} color={category?.color ?? null} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">
                  {entry.name}
                  {entry.status === "detected" && (
                    <>
                      <span aria-hidden="true" className="bg-warning ml-1.5 inline-block size-1.5 rounded-full align-middle" />
                      <span className="sr-only"> ({t("toConfirmDot")})</span>
                    </>
                  )}
                </span>
                <span className="text-muted-foreground truncate text-xs tabular-nums">{detail}</span>
              </span>
              <span className={cn("font-semibold tabular-nums", entry.amountCents > 0 && "text-positive")}>
                <ExpectedAmount cents={entry.amountCents} tracked={entry.tracked === true} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
