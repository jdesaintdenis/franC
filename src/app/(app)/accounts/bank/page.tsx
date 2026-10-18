import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { db } from "@/db/client";
import { listAccounts } from "@/db/queries/accounts";
import { getAccountBalances } from "@/db/queries/balance";
import { lastSyncInsertedByAccount, listBankConnections, newestDateByAccount } from "@/db/queries/bank-connections";
import { asLocale } from "@/i18n/config";
import { requireUser } from "@/lib/auth/session";
import type { ConnectionHealth } from "@/lib/bank-sync/health";
import { isBankSyncAllowed } from "@/lib/bank-sync/server";
import { reconnectHref } from "@/lib/bank-sync/reconnect";
import { connectionStatusText } from "@/lib/bank-sync/status-text";
import { defaultLinkChoices, uniqueAccountName, type LinkChoice } from "@/lib/bank-sync/link";
import { currentDate } from "@/lib/dashboard/month";
import { formatDateTime, formatShortDay } from "@/lib/format-date";
import { defaultSyncFrom, earliestSyncFrom } from "@/lib/bank-sync/window";

import { BankConnectionScreen } from "./bank-connection-screen";
import { CALLBACK_ERRORS, type AccountOption, type CallbackError, type ConnectionView } from "./view";

export default async function BankConnectionPage({ searchParams }: PageProps<"/accounts/bank">) {
  const user = await requireUser();
  // Hidden, not just disabled, without the Enable Banking variables or for users not in BANK_SYNC_EMAILS.
  if (!isBankSyncAllowed(user.email)) notFound();
  const [connections, accounts, balances, newest, lastInserted, rawLocale, nav, t, params] = await Promise.all([
    listBankConnections(db, user.id),
    listAccounts(user.id),
    getAccountBalances(db, user.id),
    newestDateByAccount(db, user.id),
    lastSyncInsertedByAccount(db, user.id),
    getLocale(),
    getTranslations("common.nav"),
    getTranslations("settings.bankConnection"),
    searchParams,
  ]);
  const locale = asLocale(rawLocale);
  const balanceOf = new Map(balances.map((b) => [b.id, b.balanceCents]));
  const today = currentDate(new Date());
  const syncFromMin = earliestSyncFrom(today);

  const linkByAccount = new Map<string, string>();
  for (const c of connections)
    for (const l of c.links) if (l.accountId && l.linked) linkByAccount.set(l.accountId, l.id);
  // Savings accounts take no bank link (Slice 52).
  const accountOptions: AccountOption[] = accounts
    .filter((a) => !a.savings)
    .map((a) => ({
      id: a.id,
      name: a.name,
      linkId: linkByAccount.get(a.id) ?? null,
      defaultSyncFrom: defaultSyncFrom(today, newest.get(a.id) ?? null),
    }));
  const defaultFor = (choice: LinkChoice) =>
    choice.kind === "existing"
      ? (accountOptions.find((a) => a.id === choice.accountId)?.defaultSyncFrom ?? syncFromMin)
      : syncFromMin;

  const now = new Date();
  const statusFor = (health: ConnectionHealth): string =>
    connectionStatusText({
      health,
      today,
      now,
      locale,
      t: (key, values) => t(key as Parameters<typeof t>[0], values),
    });

  const views: ConnectionView[] = connections.map((c) => {
    const needsLinking = c.links.some((l) => !l.linked);
    const suggested = defaultLinkChoices(
      c.links.map((l) => ({
        uid: l.bankAccountUid,
        displayName: l.displayName,
      })),
      accountOptions.map((a) => ({
        id: a.id,
        name: a.name,
        linked: a.linkId !== null,
      })),
    );
    const names = accounts.map((a) => a.name);
    return {
      id: c.id,
      bankName: c.aspspName,
      validUntilLabel: formatShortDay(currentDate(c.validUntil), today, locale),
      needsLinking,
      health: c.health,
      statusText: statusFor(c.health),
      reconnectHref: reconnectHref(c),
      syncFromMin,
      syncFromMax: today,
      links: c.links.map((l) => {
        const saved: LinkChoice = l.accountId ? { kind: "existing", accountId: l.accountId } : { kind: "skip" };
        const choice = l.linked ? saved : (suggested.get(l.bankAccountUid) ?? { kind: "skip" });
        const syncFrom = l.syncFrom ?? defaultFor(choice);
        let statusLabel: string | null = null;
        if (l.linked && l.accountId) {
          if (!l.lastSyncedAt)
            statusLabel = t("sync.notYet", {
              date: formatShortDay(syncFrom, today, locale),
            });
          else {
            const time = formatDateTime(l.lastSyncedAt, locale);
            const count = lastInserted.get(l.accountId);
            statusLabel = count === undefined ? t("sync.synced", { time }) : t("sync.syncedWithCount", { time, count });
          }
        }
        return {
          id: l.id,
          displayName: l.displayName,
          ibanLast4: l.ibanLast4,
          balanceCents: l.linked && l.accountId ? (balanceOf.get(l.accountId) ?? null) : null,
          accountName: l.accountName,
          choice,
          newName: choice.kind === "new" ? choice.name : uniqueAccountName(l.displayName, names),
          syncFrom,
          synced: l.lastSyncedAt !== null,
          statusLabel,
          lastAttemptAt: l.lastAttemptAt,
          lastError: l.lastError,
          failingSince: l.failingSince,
        };
      }),
    };
  });

  const error = (CALLBACK_ERRORS as readonly string[]).includes(String(params.error))
    ? (params.error as CallbackError)
    : null;

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-4 md:px-8">
        <PageHeader
          title={<PageTitle>{t("title")}</PageTitle>}
          back={{ href: "/accounts", label: nav("backToAccounts") }}
        />
        <BankConnectionScreen
          connections={views}
          accounts={accountOptions}
          error={error}
          justConnected={params.connected === "1"}
          justReconnected={params.reconnected === "1"}
        />
      </main>
    </div>
  );
}
