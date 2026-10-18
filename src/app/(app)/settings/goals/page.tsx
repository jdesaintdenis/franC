import { getTranslations } from "next-intl/server";

import { BottomAddButton } from "@/components/manage/bottom-add-button";
import { PageHeader } from "@/components/page-header";
import { db } from "@/db/client";
import { getAccountBalances } from "@/db/queries/balance";
import { listGoalMoney, listRecentContributions } from "@/db/queries/goals";
import { requireUser } from "@/lib/auth/session";
import { currentDate } from "@/lib/dashboard/month";
import { progressOfRow } from "@/lib/goals/row-progress";

import type { GoalAccountOption } from "./goal-form";
import type { AccountMoneyView } from "./goal-view";
import { GoalsScreen } from "./goals-screen";

export default async function GoalsPage() {
  const user = await requireUser();
  const nav = await getTranslations("common.nav");
  const [{ goals, money }, contributions, balances, t] = await Promise.all([
    listGoalMoney(db, user.id),
    listRecentContributions(db, user.id),
    getAccountBalances(db, user.id),
    getTranslations("settings"),
  ]);
  const today = currentDate(new Date());
  const accountOptions: GoalAccountOption[] = balances.map((b) => ({
    id: b.id,
    name: b.name,
  }));
  // One line per account that has goals: what is left to assign.
  const accountMoney: AccountMoneyView[] = balances.flatMap((b) => {
    const m = money.get(b.id);
    return m
      ? [
          {
            accountId: b.id,
            accountName: b.name,
            balanceCents: m.balanceCents,
            assignedCents: m.assignedCents,
            notAssignedCents: m.notAssignedCents,
          },
        ]
      : [];
  });

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-2 px-4 pb-4 md:px-8">
        <PageHeader
          title={
            <span className="font-title text-[22px] font-bold tracking-[0.1em] uppercase">
              {t("goals.title")}
            </span>
          }
          back={{ href: "/budget", label: nav("backToPlan") }}
        />
        <p className="text-muted-foreground px-1 text-sm">{t("goals.intro")}</p>
        <GoalsScreen
          today={today}
          createAccounts={accountOptions}
          accountMoney={accountMoney}
          goals={goals.map((goal) => ({
            goal: {
              id: goal.id,
              name: goal.name,
              targetCents: goal.targetCents,
              targetDate: goal.targetDate,
              icon: goal.icon,
              accountId: goal.accountId,
            },
            accountName: goal.accountName,
            progress: progressOfRow(goal, today),
            accounts: accountOptions,
            notAssignedCents: goal.accountId
              ? (money.get(goal.accountId)?.notAssignedCents ?? null)
              : null,
            entries: contributions.get(goal.id) ?? [],
          }))}
        />
        {goals.length > 0 && <BottomAddButton label={t("goals.add")} />}
      </main>
    </div>
  );
}
