import { ChevronRight, Clock, DatabaseBackup, Landmark, RefreshCwOff, Scale, SearchX, ListChecks, TrendingDown, TrendingUp, TriangleAlert, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";

import type { AttentionItem } from "@/lib/dashboard/attention";
import { formatShortDay } from "@/lib/format-date";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { BalanceGapRow } from "./balance-gap-row";
import { gapSentence, type BalanceGapView } from "./balance-gap";

// Rows shown before "See all": a glance, the rest is one tap away.
const VISIBLE_ROWS = 3;

type Tone = "brand" | "warning" | "destructive";

const TONE: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand",
  warning: "bg-warning-soft text-warning",
  destructive: "bg-destructive-soft text-destructive",
};

interface Row {
  key: string;
  testId: string;
  href: string;
  Icon: LucideIcon;
  tone: Tone;
  title: ReactNode;
  hint: string;
  /** Set on rows that open the gap sheet instead of navigating. */
  gap?: BalanceGapView;
}

/**
 * What needs the user's attention, as one list of tappable rows (the order comes from
 * `buildAttention`). Hidden when there is nothing to do.
 */
export function NeedsAttention({
  items,
  today,
  accountCount,
}: {
  items: AttentionItem[];
  today: string;
  /** All of the user's accounts: a single-account user never sees account names. */
  accountCount: number;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard.attention");
  const reminder = useTranslations("dashboard.importReminder");
  const review = useTranslations("dashboard.review");
  const gapT = useTranslations("dashboard.balanceGap");
  if (items.length === 0) return null;

  const money = (cents: number) => formatCents(cents, locale);
  const fmtDay = (iso: string) => formatShortDay(iso, today, locale);

  function rowOf(item: AttentionItem): Row {
    switch (item.kind) {
      case "belowNow":
        return {
          key: `below-${item.accountId}`,
          testId: "attention-below-now",
          href: "/budget#balance",
          Icon: TriangleAlert,
          tone: "destructive",
          title: t("belowNow", { name: item.name, threshold: money(item.thresholdCents) }),
          hint: t("belowNowHint"),
        };
      case "bankReconnect":
        return {
          key: `reconnect-${item.connectionId}`,
          testId: "attention-bank-reconnect",
          href: "/accounts/bank",
          Icon: Landmark,
          tone: "warning",
          title: t(
            item.reason === "refused" ? "bankReconnectRefused" : item.expired ? "bankReconnectExpired" : "bankReconnect",
            { date: fmtDay(item.expiresOn) },
          ),
          hint: t("bankConnectionHint"),
        };
      case "bankFailing":
        return {
          key: `failing-${item.connectionId}`,
          testId: "attention-bank-failing",
          href: "/accounts/bank",
          Icon: RefreshCwOff,
          tone: "warning",
          title: t("bankFailing", { date: fmtDay(item.since) }),
          hint: t("bankConnectionHint"),
        };
      case "backupFailing":
        return {
          key: "backup-failing",
          testId: "attention-backup-failing",
          href: "",
          Icon: DatabaseBackup,
          tone: "warning",
          title: t("backupFailing", { date: fmtDay(item.since) }),
          hint: t("backupFailingHint"),
        };
      case "balanceGap": {
        const gap = { accountId: item.accountId, name: accountCount > 1 ? item.name : null, amountCents: item.amountCents, from: item.from, to: item.to };
        return {
          key: `gap-${item.accountId}`,
          testId: "attention-balance-gap",
          href: "",
          Icon: Scale,
          tone: "warning",
          title: gapSentence(gapT, locale, gap, today),
          hint: t("balanceGapHint"),
          gap,
        };
      }
      case "notFound":
        return {
          key: "not-found",
          testId: "attention-not-found",
          href: "/review",
          Icon: SearchX,
          tone: "warning",
          title: t("notFound", { count: item.count }),
          hint: t("notFoundHint"),
        };
      case "staleImport": {
        const [first] = item.accounts;
        const single = item.accounts.length === 1 && first !== undefined;
        return {
          key: "stale",
          testId: "attention-stale-import",
          href: single ? `/import?account=${first.accountId}` : "/import",
          Icon: Clock,
          tone: "brand",
          title: single
            ? accountCount === 1
              ? reminder("single", { date: fmtDay(first.freshDate), days: first.ageDays })
              : reminder("account", { name: first.name, date: fmtDay(first.freshDate), days: first.ageDays })
            : reminder("several", { count: item.accounts.length, days: item.days }),
          hint: single
            ? t("importHint")
            : item.accounts.map((a) => reminder("listItem", { name: a.name, date: fmtDay(a.freshDate) })).join(", "),
        };
      }
      case "review":
        return {
          key: "review",
          testId: "attention-review",
          href: "/review",
          Icon: ListChecks,
          tone: "brand",
          title: review("text", { count: item.count }),
          hint: t("reviewHint"),
        };
      case "priceUp": {
        const { alert } = item;
        return {
          key: `price-${alert.id}`,
          testId: "attention-price-up",
          href: `/recurring?item=${alert.recurringId}`,
          Icon: TrendingUp,
          tone: "warning",
          // Old price struck through, new one in amber: short enough to read at a glance (SPEC §72).
          title: t.rich("priceUpRow", {
            name: alert.name,
            old: money(Math.abs(alert.oldAmountCents)),
            new: money(Math.abs(alert.newAmountCents)),
            was: (chunks) => <s className="text-muted-foreground font-medium">{chunks}</s>,
            now: (chunks) => <span className="text-warning font-bold">{chunks}</span>,
          }),
          hint: "",
        };
      }
      case "pricesUp":
        return {
          key: "prices",
          testId: "attention-prices-up",
          href: "/recurring",
          Icon: TrendingUp,
          tone: "warning",
          title: t("pricesUp", { count: item.count }),
          hint: t("pricesUpHint"),
        };
      case "lowAhead":
        return {
          key: `low-${item.accountId}`,
          testId: "attention-low-ahead",
          href: "/budget#balance",
          Icon: TrendingDown,
          tone: "warning",
          title: t("lowAhead", { name: item.name, threshold: money(item.thresholdCents), date: fmtDay(item.date) }),
          hint: item.cause
            ? t("lowAheadCause", { balance: money(item.balanceCents), cause: item.cause.name, amount: money(item.cause.amountCents) })
            : t("lowAheadHint", { balance: money(item.balanceCents) }),
        };
    }
  }

  const rows = items.map(rowOf);
  const renderRow = ({ key, testId, href, Icon, tone, title, hint, gap }: Row) => {
    const body = (
      <>
        <span aria-hidden="true" className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5", TONE[tone])}>
          <Icon />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold break-words">{title}</span>
          {hint && <span className="text-muted-foreground text-sm break-words">{hint}</span>}
        </span>
      </>
    );
    return (
      <li key={key}>
        {gap ? (
          <BalanceGapRow gap={gap} today={today} testId={testId}>
            {body}
          </BalanceGapRow>
        ) : href === "" ? (
          // Nothing in the app can fix it (the hint says where to look), so no link.
          <div data-testid={testId} className="flex min-h-14 items-center gap-3 px-4 py-3">
            {body}
          </div>
        ) : (
          <Link
            href={href}
            data-testid={testId}
            className="hover:bg-muted/60 focus-visible:ring-ring/50 flex min-h-14 items-center gap-3 px-4 py-3 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
          >
            {body}
            <ChevronRight className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
          </Link>
        )}
      </li>
    );
  };
  const visible = rows.slice(0, VISIBLE_ROWS);
  const rest = rows.slice(VISIBLE_ROWS);

  // The page wraps this in Home's titled section (flush), which owns the heading and the card.
  return (
    <>
      <ul className="divide-y">{visible.map(renderRow)}</ul>
      {rest.length > 0 && (
        <details className="group border-t">
          <summary className="text-primary hover:bg-muted/60 flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            {t("seeAll", { count: rows.length })}
            <ChevronRight aria-hidden="true" className="size-4 transition-transform group-open:rotate-90" />
          </summary>
          <ul className="divide-y border-t">{rest.map(renderRow)}</ul>
        </details>
      )}
    </>
  );
}
