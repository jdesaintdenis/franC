import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { formatShortDay } from "@/lib/format-date";
import { formatSignedWholeCents, formatWholeCents } from "@/lib/money";
import type { NextMonthOutlook } from "@/lib/recurring/next-month";
import { cn } from "@/lib/utils";

function Column({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="border-border flex min-w-0 flex-col gap-0.5 border-l px-2.5 first:border-0 first:pl-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={cn("text-[15px] font-bold tabular-nums", className)}>{value}</dd>
    </div>
  );
}

/** What the month should leave once payments and budgets are counted, with the three figures it comes from. */
export function OutlookCard({
  outlook,
  hasBudgets,
  dataUpTo,
  today,
}: {
  outlook: NextMonthOutlook;
  hasBudgets: boolean;
  dataUpTo: string | null;
  /** "YYYY-MM-DD" in Europe/Paris. */
  today: string;
}) {
  const locale = useLocale();
  const t = useTranslations("plan.nextMonthPage");
  const { leftCents } = outlook;
  const bold = (chunks: React.ReactNode) => <b className="font-bold tabular-nums">{chunks}</b>;
  return (
    <div className="flex flex-col gap-2.5" data-testid="next-month-left">
      <p className="text-muted-foreground text-xs">{t("leftLabel")}</p>
      <p
        className={cn("text-[34px] leading-tight font-extrabold tabular-nums", leftCents > 0 && "text-positive", leftCents < 0 && "text-warning")}
        data-testid="next-month-left-amount"
      >
        {formatSignedWholeCents(leftCents, locale)}
      </p>
      <p className="text-sm">
        {leftCents >= 0
          ? t.rich("leftSentence", { amount: formatWholeCents(leftCents, locale), b: bold })
          : t.rich("shortSentence", { amount: formatWholeCents(-leftCents, locale), b: bold })}
      </p>
      <dl className={cn("border-border grid gap-0 border-t pt-2.5", hasBudgets ? "grid-cols-3" : "grid-cols-2")}>
        <Column label={t("in")} value={formatSignedWholeCents(outlook.inCents, locale)} className="text-positive" />
        <Column label={t("payments")} value={formatSignedWholeCents(-outlook.paymentsCents, locale)} />
        {hasBudgets && <Column label={t("budgets")} value={formatSignedWholeCents(-outlook.budgetsCents, locale)} />}
      </dl>
      <p className="text-muted-foreground text-xs">
        {hasBudgets ? t("paymentsNote") : t("noBudgets")}
        {dataUpTo && ` ${t("basedOn", { date: formatShortDay(dataUpTo, today, locale) }).replace(/\.?$/, ".")}`}
      </p>
      {!hasBudgets && (
        <Link href="/settings/budgets" className="text-primary -mt-1 inline-flex min-h-11 items-center self-start text-sm font-semibold">
          {t("addBudget")}
        </Link>
      )}
    </div>
  );
}
