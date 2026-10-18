import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { formattingLocale } from "@/i18n/config";
import type { MonthCurvePoint } from "@/lib/balance/month-curve";
import type { AccountBalanceOverview, BalanceOverview } from "@/lib/balance/projection";
import { formatShortDay } from "@/lib/format-date";
import { formatCents, formatWholeCents } from "@/lib/money";

import { BalanceChart } from "./balance-chart";

function AccountRowSummary({
  account,
  today,
  bankReadAt,
}: {
  account: AccountBalanceOverview;
  today: string;
  /** When franC read the bank's balance, already formatted; undefined for a balance the user entered. */
  bankReadAt: string | undefined;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard.balance");
  const dips = account.lowest.date > account.asOf;
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium">{account.name}</span>
        <span className="shrink-0 font-semibold tabular-nums">
          {formatCents(account.balanceCents, locale)}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        {bankReadAt !== undefined
          ? t("fromBank", { when: bankReadAt })
          : account.asOf === today
            ? t("asOfToday")
            : t("asOf", { date: formatShortDay(account.asOf, today, locale) })}
      </p>
      <p className="text-muted-foreground text-xs">
        {dips
          ? t("lowest", {
              amount: formatCents(account.lowest.balanceCents, locale),
              date: formatShortDay(account.lowest.date, today, locale),
            })
          : t("noDip")}
      </p>
    </li>
  );
}

/**
 * The selected month's balance curve, with what the 30-day projection says about now on the current
 * month (SPEC §74 C). Rendered inside the page's "Solde" section. `overview.accounts` holds only
 * accounts with a starting balance; `missing` names the ones without.
 */
export function BalanceCard({
  overview,
  missing,
  today,
  bankReadAt,
  curve,
  noData,
  isCurrent,
}: {
  overview: BalanceOverview;
  missing: string[];
  today: string;
  /** Account id to "2 Oct 07:00" for accounts whose balance comes from the bank. */
  bankReadAt: Record<string, string>;
  /** End-of-day balances of the selected month; the days after the last known one are projected. */
  curve: MonthCurvePoint[];
  /** The month ends before the first known transaction: nothing to rebuild from. */
  noData: boolean;
  isCurrent: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard.balance");
  const { accounts } = overview;
  const single = accounts.length === 1 ? accounts[0] : null;

  const sinceImport = accounts.reduce((n, a) => n + a.sinceLastImport.length, 0);

  const chartData = curve.map((p) => ({
    date: p.date,
    day: String(Number(p.date.slice(8, 10))),
    label: formatShortDay(p.date, today, locale),
    balanceCents: p.balanceCents,
    projected: p.projected,
  }));
  const start = chartData[0];
  const end = chartData[chartData.length - 1];
  // Earliest day with the lowest balance.
  const low = start ? chartData.reduce((best, p) => (p.balanceCents < best.balanceCents ? p : best), start) : undefined;
  const lastReal = chartData.findLast((p) => !p.projected);
  const threshold = single ? single.thresholdCents : 0;
  const hasChart = !noData && chartData.length >= 2 && start && end && low;

  const names = new Intl.ListFormat(formattingLocale(locale), { style: "long", type: "conjunction" }).format(missing);

  return (
    <div className="flex flex-col gap-3">
      {hasChart && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground text-sm">{isCurrent ? t("monthEndProjected") : t("monthEnd")}</span>
          <p className="text-[22px] font-extrabold tabular-nums" data-testid="balance-end">
            {formatCents(end.balanceCents, locale)}
          </p>
        </div>
      )}
      {isCurrent && single && bankReadAt[single.accountId] !== undefined ? (
        <p className="text-muted-foreground text-xs" data-testid="balance-from-bank">
          {t("fromBank", { when: bankReadAt[single.accountId] })}
        </p>
      ) : (
        isCurrent &&
        single &&
        single.asOf !== today && (
          <p className="text-muted-foreground text-xs">{t("asOf", { date: formatShortDay(single.asOf, today, locale) })}</p>
        )
      )}
      {isCurrent && accounts.length > 1 && (
        <ul aria-label={t("accountsLabel")} className="flex flex-col gap-3">
          {accounts.map((a) => (
            <AccountRowSummary key={a.accountId} account={a} today={today} bankReadAt={bankReadAt[a.accountId]} />
          ))}
        </ul>
      )}
      {noData && <p className="text-muted-foreground text-sm">{t("noMonthData")}</p>}
      {hasChart && (
        <>
          <p className="text-muted-foreground text-[13px]" data-testid="balance-lowest">
            {t("monthLine", {
              start: formatCents(start.balanceCents, locale),
              low: formatCents(low.balanceCents, locale),
              date: formatShortDay(low.date, today, locale),
            })}
          </p>
          <p className="sr-only">
            {t("chartSummaryMonth", {
              start: formatCents(start.balanceCents, locale),
              end: formatCents(end.balanceCents, locale),
              low: formatCents(low.balanceCents, locale),
              date: formatShortDay(low.date, today, locale),
            })}
          </p>
          <BalanceChart data={chartData} thresholdCents={threshold} lowest={{ day: low.day, balanceCents: low.balanceCents }} />
          <div className="text-muted-foreground flex flex-col gap-1 text-[11px]">
            {threshold > 0 && (
              <p className="text-warning flex items-center gap-1.5 text-[13px] font-semibold" data-testid="balance-alert-line">
                <span aria-hidden="true" className="border-warning inline-block w-4 border-t-2 border-dashed" />
                {t("alertBelow", { threshold: formatWholeCents(threshold, locale) })}
              </p>
            )}
            <p>
              {isCurrent && lastReal
                ? t("legendCurrent", { date: formatShortDay(lastReal.date, today, locale) })
                : t("legendPast")}
            </p>
          </div>
        </>
      )}
      {isCurrent && sinceImport > 0 && <p className="text-muted-foreground text-xs">{t("sinceImport", { count: sinceImport })}</p>}
      {missing.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {t.rich("missing", {
            names,
            count: missing.length,
            link: (chunks) => (
              <Link href="/accounts" className="underline underline-offset-2">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
    </div>
  );
}

/** Shown instead of the card while no account has a starting balance. */
export function BalancePrompt() {
  const t = useTranslations("dashboard.balance");
  return (
    <p className="text-muted-foreground text-sm">
      {t.rich("prompt", {
        link: (chunks) => (
          <Link href="/accounts" className="text-foreground underline underline-offset-2">
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}
