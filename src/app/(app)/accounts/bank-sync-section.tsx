import { getLocale, getTranslations } from "next-intl/server";

import { HomeSection } from "@/app/(app)/home/home-section";
import { buttonVariants } from "@/components/ui/button";
import type { listBankConnections } from "@/db/queries/bank-connections";
import { asLocale } from "@/i18n/config";
import { reconnectHref } from "@/lib/bank-sync/reconnect";
import { connectionStatusText } from "@/lib/bank-sync/status-text";
import { currentDate } from "@/lib/dashboard/month";
import { formatShortDay } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import Link from "next/link";

import { SyncNow } from "./bank/sync-now";

type Connection = Awaited<ReturnType<typeof listBankConnections>>[number];

/**
 * The bank connections as a summary: bank, how it is doing, until when it is valid, and Sync now.
 * Linking accounts, disconnecting and connecting another bank stay on the Bank connection page.
 */
export async function BankSyncSection({ connections, today }: { connections: Connection[]; today: string }) {
  const [t, tc, rawLocale] = await Promise.all([
    getTranslations("settings.accounts"),
    getTranslations("settings.bankConnection"),
    getLocale(),
  ]);
  const locale = asLocale(rawLocale);
  const now = new Date();

  return (
    <HomeSection
      headingId="bank-sync-heading"
      title={t("sections.sync")}
      testId="bank-sync-section"
      link={connections.length > 0 ? { href: "/accounts/bank", label: t("sync.manage") } : undefined}
      flush
    >
      {connections.length === 0 ? (
        <Link
          href="/accounts/bank"
          className="hover:bg-muted/60 focus-visible:ring-ring/50 flex min-h-[52px] items-center px-3.5 font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
        >
          {t("sync.connect")}
        </Link>
      ) : (
        <ul className="divide-border divide-y">
          {connections.map((c) => {
            const href = reconnectHref(c);
            const linked = c.links.filter((l) => l.linked && l.accountId).map((l) => l.id);
            const needsLinking = c.links.some((l) => !l.linked);
            const status = connectionStatusText({
              health: c.health,
              today,
              now,
              locale,
              t: (key, values) => tc(key as Parameters<typeof tc>[0], values),
            });
            const warn = c.health.kind === "reconnect" || c.health.kind === "failing";
            return (
              <li key={c.id} className="flex flex-col gap-2 px-3.5 py-3" data-testid="bank-sync-connection">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-semibold wrap-anywhere">{c.aspspName}</span>
                    <span className={cn("text-sm", warn ? "text-warning" : "text-muted-foreground")}>
                      {needsLinking ? tc("justConnected") : status}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t("sync.validUntil", {
                        date: formatShortDay(currentDate(c.validUntil), today, locale),
                      })}
                    </span>
                  </div>
                  {href ? (
                    <a href={href} className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
                      {t("sync.reconnect")}
                    </a>
                  ) : null}
                </div>
                {!href && linked.length > 0 && <SyncNow linkIds={linked} variant="outline" />}
              </li>
            );
          })}
        </ul>
      )}
    </HomeSection>
  );
}
