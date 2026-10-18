import { getLocale, getTranslations } from "next-intl/server";

import { BottomAddButton } from "@/components/manage/bottom-add-button";
import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { db } from "@/db/client";
import { getHomeAccountId, listAccountsWithStats } from "@/db/queries/accounts";
import { listAllSavingsRules } from "@/db/queries/savings";
import { linkedBankByAccount } from "@/db/queries/bank-connections";
import { getAccountBalances } from "@/db/queries/balance";
import { getBalanceGaps } from "@/db/queries/balance-gaps";
import { getAccountFreshness, getImportReminderSettings } from "@/db/queries/import-reminder";
import { listBankConnections } from "@/db/queries/bank-connections";
import { listGoalMoney } from "@/db/queries/goals";
import { listLoanPaymentChoices, listLoans } from "@/db/queries/loans";
import { accountTotals } from "@/lib/accounts/totals";
import { isBankSyncAllowed } from "@/lib/bank-sync/server";
import { findStaleAccounts } from "@/lib/import-reminder/staleness";
import { parseVapidConfig } from "@/lib/push/config";
import { requireUser } from "@/lib/auth/session";
import { currentDate } from "@/lib/dashboard/month";
import { formatShortDay, formatShortInstantTime } from "@/lib/format-date";
import { formatCents } from "@/lib/money";

import { DataUpTo } from "../data-up-to";
import { PushToggle } from "../settings/push-toggle";
import { AccountsScreen } from "./accounts-screen";
import type { AccountView } from "./account-view";
import { AccountsTotal } from "./accounts-total";
import { BankSyncSection } from "./bank-sync-section";
import { ImportsSection } from "./imports-section";
import { loanRow } from "./loans/loan-row";
import { LoansSection } from "./loans/loans-section";

export default async function AccountsPage() {
  const user = await requireUser();
  const nav = await getTranslations("common.nav");
  const bankSyncAllowed = isBankSyncAllowed(user.email);
  const vapid = parseVapidConfig(process.env);
  const [
    accounts,
    homeAccountId,
    balances,
    freshness,
    { goals, money },
    linkedBanks,
    gaps,
    locale,
    t,
    rules,
    reminder,
    connections,
    loanData,
    loanPayments,
  ] = await Promise.all([
    listAccountsWithStats(db, user.id),
    getHomeAccountId(user.id),
    getAccountBalances(db, user.id),
    getAccountFreshness(db, user.id),
    listGoalMoney(db, user.id),
    linkedBankByAccount(db, user.id),
    getBalanceGaps(db, user.id),
    getLocale(),
    getTranslations("settings"),
    listAllSavingsRules(db, user.id),
    getImportReminderSettings(db, user.id),
    bankSyncAllowed ? listBankConnections(db, user.id) : Promise.resolve([]),
    listLoans(db, user.id),
    listLoanPaymentChoices(db, user.id),
  ]);

  const balanceById = new Map(balances.map((b) => [b.id, b]));
  // The view needs only the amount and dates, not the checkpoint id.
  const gapById = new Map(
    gaps.map((g) => [g.accountId, { amountCents: g.gap.amountCents, from: g.gap.from, to: g.gap.to }]),
  );
  const reminderById = new Map(freshness.map((f) => [f.accountId, f.reminder]));
  const now = new Date();
  const today = currentDate(now);
  // A bank-fed account syncs by itself, so only the others can be overdue for an import.
  const stale = findStaleAccounts({
    accounts: await getAccountFreshness(db, user.id, { withoutBankLink: true }),
    days: reminder.days,
    today,
  });
  const staleIds = new Set(stale.map((s) => s.accountId));

  const views: AccountView[] = accounts.map((account) => {
    const balance = balanceById.get(account.id);
    return {
      id: account.id,
      name: account.name,
      transactionCount: account.transactionCount,
      importCount: account.importCount,
      lastImport: account.lastImportAt ? formatShortDay(currentDate(account.lastImportAt), today, locale) : null,
      balanceLabel: balance?.balanceCents != null ? formatCents(balance.balanceCents, locale) : null,
      startingBalance:
        balance?.startingBalanceCents != null && balance.startingBalanceDate !== null
          ? {
              cents: balance.startingBalanceCents,
              date: balance.startingBalanceDate,
              thresholdCents: balance.thresholdCents,
            }
          : null,
      inSafeToSpend: balance?.inSafeToSpend ?? true,
      importReminder: reminderById.get(account.id) ?? true,
      savings: account.savings,
      moveCount: account.moveCount,
      savingsRules: rules
        .filter((r) => r.accountId === account.id)
        .map((r) => ({
          id: r.id,
          pattern: r.pattern,
          goalId: r.goalId,
          goalName: goals.find((g) => g.id === r.goalId)?.name ?? null,
        })),
      goals: goals
        .filter((g) => g.accountId === account.id)
        .map((g) => ({ id: g.id, name: g.name, savedCents: g.savedCents })),
      assignedLabel: (() => {
        const assigned = goals.filter((g) => g.accountId === account.id).reduce((sum, g) => sum + g.savedCents, 0);
        return assigned > 0 ? formatCents(assigned, locale) : null;
      })(),
      stale: staleIds.has(account.id),
      notAssignedCents: money.get(account.id)?.notAssignedCents ?? null,
      linkedBank: linkedBanks.get(account.id) ?? null,
      bankBalance:
        balance?.source === "bank" && balance.balanceCents !== null && balance.asOf !== null
          ? {
              label: formatCents(balance.balanceCents, locale),
              bankName: balance.bankName,
              readAt: balance.fetchedAt
                ? formatShortInstantTime(balance.fetchedAt, today, locale)
                : formatShortDay(balance.asOf, today, locale),
              thresholdCents: balance.thresholdCents,
            }
          : null,
      connected: balance?.connected ?? false,
      gap: gapById.get(account.id) ?? null,
    };
  });

  const loanRows = loanData.map((l) => loanRow(l, today, locale));
  const loansOwed = loanRows.reduce((sum, l) => sum + l.owedCents, 0);

  const totals = accountTotals(
    balances.map((b) => ({
      balanceCents: b.balanceCents,
      savings: accounts.find((a) => a.id === b.id)?.savings ?? false,
    })),
  );

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 pb-4 md:px-8">
        <PageHeader
          eyebrow={<DataUpTo accounts={freshness} today={today} listLagging />}
          title={<PageTitle>{nav("accounts")}</PageTitle>}
        />
        <AccountsTotal totals={totals} />
        <AccountsScreen accounts={views} today={today} homeAccountId={homeAccountId} />
        <LoansSection
          loans={loanRows}
          totalLabel={loanRows.length > 0 ? formatCents(-loansOwed, locale) : null}
          payments={loanPayments.map((p) => ({ id: p.id, name: p.name, typicalAmountCents: p.typicalAmountCents }))}
          today={today}
        />
        {bankSyncAllowed && <BankSyncSection connections={connections} today={today} />}
        <ImportsSection
          stale={stale}
          reminderDays={reminder.days}
          bankSyncAllowed={bankSyncAllowed}
          push={vapid ? <PushToggle publicKey={vapid.publicKey} /> : undefined}
        />
        <BottomAddButton label={t("accounts.new")} />
      </main>
    </div>
  );
}
