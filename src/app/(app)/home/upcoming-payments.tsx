import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { CategoryTile } from "@/components/category-tile";
import { EmptyState } from "@/components/empty-state";
import { ExpectedAmount } from "@/components/expected-amount";
import { BIG_BILL_CENTS, isBigBill, type UpcomingBills } from "@/lib/dashboard/upcoming-bills";
import { formatDay } from "@/lib/format-date";
import { formatCents, formatWholeCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { UpcomingStrip } from "./upcoming-strip";

/** What is still due this month: the total, the month strip, and the three biggest bills (SPEC §80). */
export function UpcomingPayments({
  upcoming,
  today,
  categories,
}: {
  upcoming: UpcomingBills;
  /** "YYYY-MM-DD" in Europe/Paris. */
  today: string;
  /** category id -> how its tile looks. */
  categories: ReadonlyMap<string, { icon: string | null; color: string | null }>;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard.upcoming");
  if (upcoming.count === 0) return <EmptyState compact headingLevel="h3" icon={CalendarDays} title={t("empty")} className="px-0" />;
  const limit = formatWholeCents(BIG_BILL_CENTS, locale);
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <b className="text-xl font-extrabold tabular-nums" data-testid="upcoming-total">
          {formatCents(upcoming.totalCents, locale)}
        </b>
        <span className="text-muted-foreground text-sm">{t("left", { count: upcoming.count })}</span>
      </p>
      <UpcomingStrip upcoming={upcoming} today={today} />
      <p className="text-muted-foreground text-xs">
        {upcoming.bigCount > 0 ? (
          <>
            <span aria-hidden="true" className="bg-sand mr-1.5 inline-block size-[11px] rounded-full align-[-1px]" />
            {t("bigKey", { count: upcoming.bigCount, limit })}
            {" · "}
            <span aria-hidden="true" className="bg-muted-foreground mr-1.5 inline-block size-2 rounded-full" />
            {t("smallKey", { limit })}
          </>
        ) : (
          <>
            <span aria-hidden="true" className="bg-muted-foreground mr-1.5 inline-block size-2 rounded-full" />
            <span className="text-positive">{t("onlySmall", { limit })}</span>
          </>
        )}
      </p>
      <ul aria-label={t("biggest")} className="divide-border -mb-1 divide-y">
        {upcoming.biggest.map((bill) => {
          const look = bill.categoryId ? categories.get(bill.categoryId) : undefined;
          return (
            <li key={`${bill.id}-${bill.date}`}>
              <Link
                href={`/recurring?item=${bill.id}`}
                className="focus-visible:ring-ring/50 -mx-1 flex min-h-14 items-center gap-2.5 rounded-md px-1 py-2 outline-none focus-visible:ring-[3px]"
              >
                <CategoryTile icon={look?.icon ?? null} color={look?.color ?? null} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{bill.name}</span>
                  <span className="text-muted-foreground text-xs">{formatDay(bill.date, today, locale)}</span>
                </span>
                <span className={cn("shrink-0 text-sm font-bold tabular-nums", isBigBill(bill) && "text-sand")}>
                  <ExpectedAmount cents={bill.amountCents} tracked={bill.tracked} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
