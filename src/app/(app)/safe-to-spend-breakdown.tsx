import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { formatShortDay } from "@/lib/format-date";
import { formatCents, formatSignedCents } from "@/lib/money";
import type { SafeToSpendResult } from "@/lib/safe-to-spend/compute";
import { cn } from "@/lib/utils";

import { DetectedBadge } from "./recurring/detected-badge";

export function settingsLink(href: string) {
  return function SettingsLink(chunks: React.ReactNode) {
    return (
      <Link href={href} className="text-foreground underline underline-offset-2">
        {chunks}
      </Link>
    );
  };
}

function Line({ label, value, strong }: { label: React.ReactNode; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "font-semibold")}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

/** The safe-to-spend arithmetic, with cents. Server-rendered and shown inside the hero's sheet. */
export function SafeToSpendBreakdown({ result, today }: { result: SafeToSpendResult; today: string }) {
  const locale = useLocale();
  const t = useTranslations("dashboard.safeToSpend");
  return (
    <div className="flex flex-col gap-3 text-sm">
      <Line label={t("balance")} value={formatCents(result.balanceCents, locale)} />

      <div className="flex flex-col gap-1">
        <Line label={`+ ${t("income")}`} value={formatSignedCents(result.incomeCents, locale)} />
        {result.income.length === 0 ? (
          <p className="text-muted-foreground text-xs">{t("noIncome")}</p>
        ) : (
          <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
            {result.income.map((i) => (
              <li key={`${i.id}-${i.date}`} className="flex justify-between gap-3">
                <span className="min-w-0 break-words">{`${i.name} · ${formatShortDay(i.date, today, locale)}`}</span>
                <span className="shrink-0 tabular-nums">{formatSignedCents(i.amountCents, locale)}</span>
              </li>
            ))}
          </ul>
        )}
        {result.ignoredDetectedIncomeCount > 0 && (
          <p className="text-muted-foreground text-xs">
            {t.rich("ignoredIncome", {
              count: result.ignoredDetectedIncomeCount,
              link: settingsLink("/recurring"),
            })}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Line
          label={`− ${t("bills", { count: result.bills.length })}`}
          value={formatSignedCents(-result.billsCents, locale)}
        />
        {result.bills.length === 0 ? (
          <p className="text-muted-foreground text-xs">{t("noBills")}</p>
        ) : (
          <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
            {result.bills.map((b) => (
              <li key={`${b.id}-${b.date}`} className="flex justify-between gap-3">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="break-words">{`${b.name} · ${formatShortDay(b.date, today, locale)}`}</span>
                  {b.status === "detected" && <DetectedBadge />}
                </span>
                <span className="shrink-0 tabular-nums">{formatSignedCents(b.amountCents, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Line label={`− ${t("budgets")}`} value={formatSignedCents(-result.budgetsLeftCents, locale)} />
        {result.budgets.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t.rich("noBudgets", { link: settingsLink("/settings/budgets") })}
          </p>
        ) : (
          <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
            {result.budgets.map((b) => (
              <li key={b.categoryId} className="flex justify-between gap-3">
                <span className="min-w-0 break-words">
                  {b.parentName ? `${b.parentName} > ${b.name}` : b.name}
                  {b.billsCents > 0 && ` (${t("includesBills", { amount: formatCents(b.billsCents, locale) })})`}
                </span>
                <span className="shrink-0 tabular-nums">{formatCents(b.reservedCents, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t pt-2">
        <Line strong label={`= ${t("result")}`} value={formatCents(result.safeCents, locale)} />
      </div>
    </div>
  );
}
