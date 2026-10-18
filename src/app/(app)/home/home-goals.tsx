import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import type { GoalRow } from "@/db/queries/goals";
import { HOME_LIST_MAX } from "@/lib/dashboard/home-lists";
import { compareGoals } from "@/lib/goals/progress";
import { progressOfRow } from "@/lib/goals/row-progress";
import { formatCents, formatPercent } from "@/lib/money";

import { cn } from "@/lib/utils";

import { GAUGE_ROW_CLASS } from "./budget-gauge-row";
import { GoalGaugeRowContent } from "./goal-gauge-row";

/** Savings goals in the budgets' row shape, without a pace tick: a goal has no month to keep up with. */
export function HomeGoals({
  goals,
  today,
  max = HOME_LIST_MAX,
  testId = "home-goals",
}: {
  goals: GoalRow[];
  today: string;
  max?: number;
  testId?: string;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard.goals");
  const ordered = goals
    .map((goal) => ({ goal, progress: progressOfRow(goal, today), name: goal.name, targetDate: goal.targetDate }))
    .sort(compareGoals)
    .slice(0, max);

  return (
    <ul aria-label={t("listLabel")} data-testid={testId} className="divide-border -my-1 divide-y">
      {ordered.map(({ goal, progress }) => (
        <li key={goal.id}>
          <Link
            href="/settings/goals"
            className={cn(
              GAUGE_ROW_CLASS,
              "focus-visible:ring-ring/50 -mx-1 rounded-md px-1 py-3 outline-none focus-visible:ring-[3px]",
            )}
          >
            <GoalGaugeRowContent
              icon={goal.icon}
              name={goal.name}
              detail={t("of", { saved: formatCents(progress.savedCents, locale), target: formatCents(goal.targetCents, locale) })}
              percent={progress.percent}
              trailing={<span className="row-span-2 text-[22px] font-extrabold tabular-nums">{formatPercent(progress.percent, locale)}</span>}
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
