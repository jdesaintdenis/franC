import { isBankSyncAllowed } from "@/lib/bank-sync/server";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";

import { db } from "@/db/client";
import { getDailySpending, getMonthlyHistory } from "@/db/queries/dashboard";
import { listAccounts } from "@/db/queries/accounts";
import { getAccountBalances } from "@/db/queries/balance";
import { getBalanceGaps } from "@/db/queries/balance-gaps";
import { getBudgetProgress, getRecurringCharges } from "@/db/queries/budgets";
import { getBackupStatus } from "@/db/queries/backup-status";
import { listBankConnections } from "@/db/queries/bank-connections";
import { countNotFound } from "@/db/queries/manual-transactions";
import { getAccountFreshness, getImportReminderSettings } from "@/db/queries/import-reminder";
import { listGoals } from "@/db/queries/goals";
import { listCategories } from "@/db/queries/categories";
import { listOpenPriceAlerts } from "@/db/queries/price-alerts";
import { countToReview } from "@/db/queries/review";
import { listRecurring } from "@/db/queries/recurring";
import { requireUser } from "@/lib/auth/session";
import { buildBalanceOverview } from "@/lib/balance/projection";
import { attachCharges, buildBudgetOverview } from "@/lib/budgets/progress";
import { addMonths, currentDate, currentMonth, monthRange } from "@/lib/dashboard/month";
import { formatInstantTimeOrDay, zonedIsoDay, formatShortInstant } from "@/lib/format-date";
import { syncLine } from "@/lib/bank-sync/sync-line";
import { findStaleAccounts } from "@/lib/import-reminder/staleness";
import { forecastMonth, toForecastItem } from "@/lib/recurring/forecast";
import { monthProgress, showsNextMonth } from "@/lib/safe-to-spend/per-day";
import { buildPaceSeries } from "@/lib/safe-to-spend/pace-series";
import { chargesByEntry } from "@/lib/budgets/charges";
import { buildSafeToSpend } from "@/lib/safe-to-spend/compute";
import { buildWelcomeSteps } from "@/lib/dashboard/welcome";
import { getWelcomeFacts, markWelcomeCompleted } from "@/db/queries/welcome";
import { buildAttention } from "@/lib/dashboard/attention";
import { latestMonthWithData } from "@/lib/dashboard/month-picker";
import { homeBudgets } from "@/lib/dashboard/home-lists";
import { buildUpcomingBills } from "@/lib/dashboard/upcoming-bills";

import { DataUpTo } from "./data-up-to";
import { HomeBudgets, HomeBudgetsPrompt } from "./home/home-budgets";
import { HomeGoals } from "./home/home-goals";
import { HomeSection } from "./home/home-section";
import { NeedsAttention } from "./needs-attention";
import { UpcomingPayments } from "./home/upcoming-payments";
import { SafeToSpendHero, SafeToSpendPrompt } from "./safe-to-spend-hero";
import { SyncStatusLine } from "./sync-status-line";
import { WelcomeChecklist } from "./welcome-checklist";

/**
 * Home: a short summary of where the accounts stand now, in the 50 F look (SPEC §72). Nothing to do
 * here, only links to where it is done. The month views live on /month.
 */
export default async function Home() {
  const locale = await getLocale();
  const tw = await getTranslations("dashboard.welcome");
  const ts = await getTranslations("dashboard.syncLine");
  const tsts = await getTranslations("dashboard.safeToSpend");
  const ta = await getTranslations("dashboard.attention");
  const tbud = await getTranslations("dashboard.budgets");
  const tg = await getTranslations("dashboard.goals");
  const tup = await getTranslations("dashboard.upcoming");
  const nav = await getTranslations("common.nav");
  const user = await requireUser();
  const today = new Date();
  const now = currentMonth(today);
  const todayDate = currentDate(today);

  const [accounts, toReview, history, allRecurring, budgetRows, categories, priceAlerts, balances, goals, freshness, reminderSettings, welcomeFacts, balanceGaps, bankConnections, notFoundCount, paidCharges, backup] = await Promise.all([
    listAccounts(user.id),
    countToReview(db, user.id),
    // Only to know whether the user has any data at all ("latest month with data").
    getMonthlyHistory(db, user.id),
    listRecurring(db, user.id),
    getBudgetProgress(db, user.id, monthRange(now)),
    listCategories(user.id),
    // Every account: Home is the whole picture, never one account's.
    listOpenPriceAlerts(db, user.id, {}),
    getAccountBalances(db, user.id),
    listGoals(db, user.id),
    getAccountFreshness(db, user.id, { withoutBankLink: true }),
    getImportReminderSettings(db, user.id),
    getWelcomeFacts(db, user.id),
    getBalanceGaps(db, user.id),
    // Empty without bank sync; the health of each connection feeds Needs attention.
    listBankConnections(db, user.id),
    // Rows added by hand that the bank never showed.
    countNotFound(db, user.id, todayDate),
    // Regular payments already made this month, for the budgets' gauges.
    getRecurringCharges(db, user.id, monthRange(now)),
    // The nightly backup belongs to the deployment, so only its owner (who has bank sync) hears about it.
    isBankSyncAllowed(user.email) ? getBackupStatus(db) : null,
  ]);
  // The hero's chart counts the accounts the number itself counts.
  const daily = await getDailySpending(
    db,
    user.id,
    monthRange(now),
    balances.filter((b) => b.inSafeToSpend).map((b) => b.id),
  );
  const latest = latestMonthWithData(history);
  const forecastItems = allRecurring.map(toForecastItem);
  const staleAccounts = findStaleAccounts({ accounts: freshness, days: reminderSettings.days, today: todayDate });

  const balanceOverview = buildBalanceOverview({
    accounts: balances.flatMap((b) =>
      b.balanceCents !== null && b.asOf !== null
        ? [{ accountId: b.id, name: b.name, balanceCents: b.balanceCents, asOf: b.asOf, thresholdCents: b.thresholdCents }]
        : [],
    ),
    items: forecastItems,
    today: todayDate,
  });
  const anyBalance = balances.some((b) => b.balanceCents !== null);

  const safeToSpend = buildSafeToSpend({
    accounts: balances.map((b) => ({
      accountId: b.id,
      name: b.name,
      balanceCents: b.balanceCents,
      asOf: b.asOf,
      inSafeToSpend: b.inSafeToSpend,
    })),
    items: forecastItems,
    budgetRows,
    parentOf: new Map(categories.map((c) => [c.id, c.parentId])),
    today: todayDate,
  });
  // A due bill counts in the budget that covers it, as in safe to spend.
  const progress = monthProgress(todayDate);
  const unchargedBudgets = buildBudgetOverview(budgetRows, {
    ...progress,
    billsDueCents: new Map(safeToSpend.budgets.map((b) => [b.categoryId, b.billsCents])),
  });
  const currentBudgets = attachCharges(
    unchargedBudgets,
    chargesByEntry({
      categoryIds: unchargedBudgets.items.flatMap((i) => [i.categoryId, ...i.children.map((c) => c.categoryId)]),
      paid: paidCharges,
      due: safeToSpend.bills,
      names: new Map(allRecurring.map((r) => [r.id, r.name])),
      parentOf: new Map(categories.map((c) => [c.id, c.parentId])),
    }),
  );
  // The bills the Reste à vivre sheet subtracts, so the card and the sheet always agree.
  const upcoming = buildUpcomingBills(safeToSpend.bills, todayDate);
  const categoryLooks = new Map(categories.map((c) => [c.id, { icon: c.icon, color: c.color }]));
  const pace = buildPaceSeries({ daily, today: todayDate, safeCents: safeToSpend.safeCents });
  const nextMonthNet = showsNextMonth(todayDate) ? forecastMonth(forecastItems, addMonths(now, 1)).summary.all.netCents : 0;

  const welcome = buildWelcomeSteps({
    hasTransactions: welcomeFacts.hasTransactions,
    toReview,
    hasBalance: anyBalance,
    hasBudget: welcomeFacts.hasBudget,
    bankSync: isBankSyncAllowed(user.email),
    hasBankLink: bankConnections.some((c) => c.links.some((l) => l.imported)),
  });
  // Finishing is remembered, so a later import with rows to review doesn't bring the card back.
  // The UPDATE is idempotent, which makes writing during render acceptable here.
  if (!welcomeFacts.completed && welcome.allDone) await markWelcomeCompleted(db, user.id);
  const showChecklist = !welcomeFacts.completed && !welcome.allDone;
  const firstRun = showChecklist && !welcomeFacts.hasTransactions;

  const attention = buildAttention({
    staleAccounts,
    reminderDays: reminderSettings.days,
    // The checklist already asks for the review while it is shown.
    toReview: showChecklist ? 0 : toReview,
    priceAlerts,
    balances: balanceOverview.accounts,
    backupFailingSince: backup?.failingSince ? currentDate(backup.failingSince) : null,
    bankReconnects: bankConnections.flatMap((c) =>
      c.health.kind === "reconnect"
        ? [{ connectionId: c.id, bankName: c.aspspName, expiresOn: c.health.expiresOn, expired: c.health.expired, reason: c.health.reason }]
        : [],
    ),
    bankFailing: bankConnections.flatMap((c) =>
      c.health.kind === "failing"
        ? [{ connectionId: c.id, bankName: c.aspspName, since: currentDate(c.health.since) }]
        : [],
    ),
    notFound: notFoundCount,
    gaps: balanceGaps.map((g) => ({
      accountId: g.accountId,
      name: g.accountName,
      amountCents: g.gap.amountCents,
      from: g.gap.from,
      to: g.gap.to,
    })),
  });

  // Home's sync line: whenever a bank link feeds an account, even while a manual account keeps Import.
  const importing = bankConnections.filter((c) => c.links.some((l) => l.imported));
  const line = syncLine(importing.map((c) => c.health));
  const syncLinkIds = importing.flatMap((c) => c.links.filter((l) => l.imported).map((l) => l.id));
  let lineText = "";
  if (line?.kind === "synced") {
    const time = formatInstantTimeOrDay(line.at, todayDate, locale);
    lineText = ts(zonedIsoDay(line.at) === todayDate ? "syncedToday" : "syncedOn", { time });
  }
  else if (line?.kind === "failing") lineText = ts("failing", { date: formatShortInstant(line.since, todayDate, locale) });
  else if (line) lineText = ts(line.kind);

  const budgetsShown = homeBudgets(currentBudgets);
  const heroVisible = latest !== null;

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 pb-6 md:px-8 lg:max-w-5xl">
        <PageHeader
          eyebrow={<DataUpTo accounts={freshness} today={todayDate} listLagging />}
          title={<span className="font-title text-[26px] font-bold tracking-wide">{nav("home")}</span>}
        />
        {line && <SyncStatusLine kind={line.kind} text={lineText} linkIds={syncLinkIds} />}
        {firstRun ? (
          <>
            <p className="text-muted-foreground px-1" data-testid="welcome-intro">
              {tw("intro")}
            </p>
            <WelcomeChecklist welcome={welcome} />
          </>
        ) : (
          // Phone: one column, in the order Reste à vivre, À traiter, Budgets, À venir ce mois-ci, Objectifs.
          // From lg: Reste à vivre and À traiter on the left, the three lists on the right.
          <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6">
            <div className="flex flex-col gap-2">
              {showChecklist && <WelcomeChecklist welcome={welcome} />}
              {heroVisible &&
                (safeToSpend.noAccountCounted ? (
                  !showChecklist && (
                    <HomeSection headingId="safe-to-spend-section" title={tsts("result")}>
                      <SafeToSpendPrompt />
                    </HomeSection>
                  )
                ) : (
                  <HomeSection headingId="safe-to-spend-section" title={tsts("result")} bare>
                    <SafeToSpendHero result={safeToSpend} today={todayDate} nextMonth={{ month: addMonths(now, 1), netCents: nextMonthNet }} pace={pace} />
                  </HomeSection>
                ))}
              {attention.length > 0 && (
                <HomeSection headingId="needs-attention-heading" title={ta("heading")} testId="needs-attention" flush>
                  <NeedsAttention items={attention} today={todayDate} accountCount={accounts.length} />
                </HomeSection>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {budgetsShown.total > 0 ? (
                <HomeSection
                  headingId="budgets-heading"
                  title={tbud("heading")}
                  link={{ href: "/budget", label: budgetsShown.total > budgetsShown.shown.length ? tbud("allCount", { count: budgetsShown.total }) : tbud("all") }}
                >
                  <HomeBudgets overview={currentBudgets} month={now} pace={progress} />
                </HomeSection>
              ) : (
                categories.length > 0 && (
                  <HomeSection headingId="budgets-heading" title={tbud("heading")}>
                    <HomeBudgetsPrompt />
                  </HomeSection>
                )
              )}
              {heroVisible && !safeToSpend.noAccountCounted && (
                <HomeSection headingId="upcoming-heading" title={tup("heading")} link={{ href: "/recurring", label: tup("all") }} testId="home-upcoming">
                  <UpcomingPayments upcoming={upcoming} today={todayDate} categories={categoryLooks} />
                </HomeSection>
              )}
              {goals.length > 0 && (
                <HomeSection headingId="goals-heading" title={tg("heading")} link={{ href: "/settings/goals", label: tg("all") }}>
                  <HomeGoals goals={goals} today={todayDate} />
                </HomeSection>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
