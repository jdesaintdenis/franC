"use client";

import {
  ArrowRightLeft,
  MinusCircle,
  Pencil,
  Plus,
  PlusCircle,
  Target,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { ListRowTransition } from "@/components/list-row-transition";
import { EmptyState } from "@/components/empty-state";
import { EmptyAddLink } from "@/components/manage/empty-add-link";
import { rememberReturnFocus } from "@/components/manage/return-focus";
import { RowMenu, type RowMenuItem } from "@/components/manage/row-menu";
import { useSheetParam } from "@/components/manage/use-sheet-param";
import { ToastViewport, useToast } from "@/components/toast";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatMonthLabel, inSentence } from "@/lib/dashboard/month";
import { contributionPresets } from "@/lib/goals/presets";
import { assignedPercent } from "@/lib/goals/money";
import { goalsSummary } from "@/lib/goals/summary";
import { formatCents } from "@/lib/money";
import { networkErrorMessage } from "@/lib/offline";
import { cn } from "@/lib/utils";

import { GAUGE_ROW_CLASS } from "../../home/budget-gauge-row";
import { BlockGauge } from "../../home/block-gauge";
import { GoalGaugeRowContent } from "../../home/goal-gauge-row";
import { HomeSection } from "../../home/home-section";

import { deleteGoalAction, restoreGoalAction } from "./actions";
import { ContributionForm } from "./contribution-form";
import { GoalForm, type GoalAccountOption } from "./goal-form";
import type { AccountMoneyView, GoalView } from "./goal-view";
import { MoveGoalForm } from "./move-goal-form";

/** The goals list with its sheets: add and edit (`?add=1`, `?edit=<id>`), and money in or out. */
export function GoalsScreen({
  goals,
  createAccounts,
  accountMoney,
  today,
}: {
  goals: GoalView[];
  createAccounts: GoalAccountOption[];
  accountMoney: AccountMoneyView[];
  today: string;
}) {
  const t = useTranslations("settings.goals");
  const locale = useLocale();
  const tManage = useTranslations("settings.manage");
  const tOffline = useTranslations("settings");
  const toast = useToast();
  const sheet = useSheetParam();
  const [money, setMoney] = useState<{
    goalId: string;
    direction: "add" | "remove";
  } | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const editing = goals.find((g) => g.goal.id === sheet.editing) ?? null;
  const moneyGoal = goals.find((g) => g.goal.id === money?.goalId) ?? null;
  const movingGoal = goals.find((g) => g.goal.id === movingId) ?? null;
  const moveTargets = movingGoal
    ? goals
        .filter(
          (g) =>
            g.goal.id !== movingId &&
            g.goal.accountId === movingGoal.goal.accountId,
        )
        .map((g) => ({ id: g.goal.id, name: g.goal.name }))
    : [];

  function remove(view: GoalView) {
    startTransition(async () => {
      try {
        const result = await deleteGoalAction(view.goal.id);
        if (result.status === "error") {
          toast.show({ message: result.error, variant: "error" });
          return;
        }
        const snapshot = result.snapshot;
        toast.show({
          message: t("toast.deleted", { name: view.goal.name }),
          undo: {
            onUndo: async () => {
              try {
                const restored = await restoreGoalAction(snapshot);
                if (restored.status === "error")
                  toast.show({ message: restored.error, variant: "error" });
              } catch {
                toast.show({
                  message: tManage("undoFailed"),
                  variant: "error",
                });
              }
            },
          },
        });
      } catch {
        toast.show({
          message: networkErrorMessage(
            tManage("deleteFailed"),
            tOffline("offline"),
          ),
          variant: "error",
        });
      }
    });
  }

  function menuOf(view: GoalView): RowMenuItem[] {
    const manual = view.goal.accountId === null;
    const shared = goals.some(
      (g) =>
        g.goal.id !== view.goal.id && g.goal.accountId === view.goal.accountId,
    );
    return [
      {
        label: t(manual ? "menu.addMoney" : "menu.assign"),
        icon: <PlusCircle className="size-4" />,
        onSelect: () => setMoney({ goalId: view.goal.id, direction: "add" }),
      },
      {
        label: t(manual ? "menu.takeOut" : "menu.unassign"),
        icon: <MinusCircle className="size-4" />,
        onSelect: () => setMoney({ goalId: view.goal.id, direction: "remove" }),
      },
      ...(!manual && shared
        ? [
            {
              label: t("menu.moveToGoal"),
              icon: <ArrowRightLeft className="size-4" />,
              onSelect: () => setMovingId(view.goal.id),
            },
          ]
        : []),
      {
        label: tManage("edit"),
        icon: <Pencil className="size-4" />,
        onSelect: () => sheet.openEdit(view.goal.id),
      },
      {
        label: tManage("delete"),
        icon: <Trash2 className="size-4" />,
        destructive: true,
        onSelect: () => remove(view),
      },
    ];
  }

  function hintOf(view: GoalView): string | undefined {
    if (view.goal.accountId === null) return undefined;
    if (money?.direction === "remove")
      return t("contribution.holdsHint", {
        name: view.goal.name,
        amount: formatCents(view.progress.savedCents, locale),
      });
    if (view.notAssignedCents === null) return undefined;
    return t("contribution.notAssignedHint", {
      amount: formatCents(view.notAssignedCents, locale),
      account: view.accountName ?? "",
    });
  }

  return (
    <>
      {goals.length > 0 && <SummaryCard goals={goals} />}
      {accountMoney.length > 0 && <AccountCards accounts={accountMoney} />}
      {goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title={t("empty.title")}
          body={t("empty.body")}
          action={<EmptyAddLink label={t("empty.action")} />}
        />
      ) : (
        <HomeSection headingId="goals-list" title={t("listLabel")}>
          <ul
            aria-label={t("listLabel")}
            className="divide-border -my-1 divide-y"
          >
            {goals.map((view) => {
              const { goal, progress } = view;
              const manual = goal.accountId === null;
              return (
                <ListRowTransition key={goal.id} scope="goal" id={goal.id}>
                  <li className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={t("row.open", { name: goal.name })}
                      onClick={(event) => {
                        rememberReturnFocus(event.currentTarget);
                        sheet.openEdit(goal.id);
                      }}
                      className={cn(
                        GAUGE_ROW_CLASS,
                        "focus-visible:ring-ring/50 min-w-0 flex-1 rounded-md py-3 text-left outline-none focus-visible:ring-[3px]",
                      )}
                    >
                      <GoalGaugeRowContent
                        icon={goal.icon}
                        name={goal.name}
                        detail={<GoalDetail view={view} />}
                        percent={progress.percent}
                      />
                    </button>
                    <button
                      type="button"
                      aria-label={t(
                        manual
                          ? "contribution.titleAdd"
                          : "contribution.titleAssign",
                        { name: goal.name },
                      )}
                      onClick={(event) => {
                        rememberReturnFocus(event.currentTarget);
                        setMoney({ goalId: goal.id, direction: "add" });
                      }}
                      className="bg-primary/16 text-primary focus-visible:ring-ring/50 flex size-11 shrink-0 items-center justify-center rounded-[10px] outline-none focus-visible:ring-[3px]"
                    >
                      <Plus className="size-5" aria-hidden="true" />
                    </button>
                    <RowMenu
                      label={tManage("options", { name: goal.name })}
                      items={menuOf(view)}
                    />
                  </li>
                </ListRowTransition>
              );
            })}
          </ul>
        </HomeSection>
      )}

      <Sheet
        open={sheet.adding}
        onOpenChange={(open) => !open && sheet.close()}
      >
        <SheetContent className="theme-50f" title={t("addHeading")}>
          <GoalForm
            mode="create"
            accounts={createAccounts}
            today={today}
            onSaved={() => {
              sheet.close();
              toast.show({ message: t("toast.added") });
            }}
          />
          <ToastViewport inSheet />
        </SheetContent>
      </Sheet>

      <Sheet
        open={editing !== null}
        onOpenChange={(open) => !open && sheet.close()}
      >
        {editing && (
          <SheetContent className="theme-50f" title={editing.goal.name}>
            <GoalForm
              mode="edit"
              goal={editing.goal}
              accounts={editing.accounts}
              today={today}
              onDelete={() => {
                sheet.close();
                remove(editing);
              }}
              onSaved={() => {
                sheet.close();
                toast.show({ message: t("toast.saved") });
              }}
            />
            <ToastViewport inSheet />
          </SheetContent>
        )}
      </Sheet>

      <Sheet
        open={money !== null && moneyGoal !== null}
        onOpenChange={(open) => !open && setMoney(null)}
      >
        {money && moneyGoal && (
          <SheetContent
            className="theme-50f"
            title={t(
              moneyGoal.goal.accountId === null
                ? money.direction === "add"
                  ? "contribution.titleAdd"
                  : "contribution.titleTake"
                : money.direction === "add"
                  ? "contribution.titleAssign"
                  : "contribution.titleUnassign",
              { name: moneyGoal.goal.name },
            )}
          >
            <ContributionForm
              goalId={moneyGoal.goal.id}
              name={moneyGoal.goal.name}
              direction={money.direction}
              mode={moneyGoal.goal.accountId === null ? "manual" : "assign"}
              hint={hintOf(moneyGoal)}
              presets={contributionPresets({
                mode: moneyGoal.goal.accountId === null ? "manual" : "assign",
                direction: money.direction,
                monthlyCents: moneyGoal.progress.monthlyCents,
                remainingCents: moneyGoal.progress.remainingCents,
                notAssignedCents: moneyGoal.notAssignedCents,
              })}
              onSwitchDirection={() =>
                setMoney({
                  goalId: moneyGoal.goal.id,
                  direction: money.direction === "add" ? "remove" : "add",
                })
              }
              entries={moneyGoal.entries}
              today={today}
              onDone={(direction) => {
                setMoney(null);
                toast.show({
                  message: t(
                    direction === "add"
                      ? "toast.moneyAdded"
                      : "toast.moneyTaken",
                  ),
                });
              }}
            />
            <ToastViewport inSheet />
          </SheetContent>
        )}
      </Sheet>

      <Sheet
        open={movingGoal !== null}
        onOpenChange={(open) => !open && setMovingId(null)}
      >
        {movingGoal && moveTargets.length > 0 && (
          <SheetContent
            className="theme-50f"
            title={t("moveForm.title", { name: movingGoal.goal.name })}
          >
            <MoveGoalForm
              fromGoalId={movingGoal.goal.id}
              fromName={movingGoal.goal.name}
              holdsCents={movingGoal.progress.savedCents}
              targets={moveTargets}
              today={today}
              onDone={(amount, to) => {
                setMovingId(null);
                toast.show({
                  message: t("moveForm.done", {
                    amount,
                    from: movingGoal.goal.name,
                    to,
                  }),
                });
              }}
            />
            <ToastViewport inSheet />
          </SheetContent>
        )}
      </Sheet>
    </>
  );
}

/** One card per account behind goals: its balance, what the goals hold, what is left to assign. */
function AccountCards({ accounts }: { accounts: AccountMoneyView[] }) {
  const t = useTranslations("settings.goals");
  const locale = useLocale();
  return (
    <ul
      aria-label={t("accounts.label")}
      data-testid="not-assigned"
      className="flex flex-col gap-2"
    >
      {accounts.map((a) => {
        const left = a.notAssignedCents;
        return (
          <li
            key={a.accountId}
            className="bg-card flex flex-col gap-2 rounded-lg border p-3.5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-sm font-semibold break-words">
                {a.accountName}
              </span>
              {a.balanceCents !== null && (
                <span className="shrink-0 text-base font-extrabold tabular-nums">
                  {formatCents(a.balanceCents, locale)}
                </span>
              )}
            </div>
            {left === null ? (
              <Link
                href="/accounts"
                className="text-muted-foreground text-xs underline underline-offset-2"
              >
                {t("accounts.noBalance", { account: a.accountName })}
              </Link>
            ) : (
              <>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {t("accounts.assigned", {
                    amount: formatCents(a.assignedCents, locale),
                  })}
                  {" · "}
                  {left > 0 ? (
                    <span className="text-warning">
                      {t("accounts.toAssign", {
                        amount: formatCents(left, locale),
                      })}
                    </span>
                  ) : left === 0 ? (
                    t("accounts.allAssigned")
                  ) : (
                    <span className="text-warning">
                      {t("accounts.overAssigned", {
                        amount: formatCents(-left, locale),
                      })}
                    </span>
                  )}
                </p>
                <BlockGauge
                  percent={assignedPercent(a) ?? 0}
                  tone={left < 0 ? "warning" : "sand"}
                />
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SummaryCard({ goals }: { goals: GoalView[] }) {
  const t = useTranslations("settings.goals");
  const locale = useLocale();
  const summary = goalsSummary(
    goals.map((g) => ({
      targetCents: g.goal.targetCents,
      progress: g.progress,
    })),
  );
  return (
    <div className="bg-card flex flex-col gap-2 rounded-lg border p-3.5">
      <p className="text-muted-foreground text-sm tabular-nums">
        {t.rich("summary.saved", {
          saved: formatCents(summary.savedCents, locale),
          target: formatCents(summary.targetCents, locale),
          big: (chunks) => (
            <span className="text-foreground text-[28px] leading-none font-extrabold">
              {chunks}
            </span>
          ),
        })}
      </p>
      <BlockGauge percent={summary.percent} tone="sand" />
      {summary.monthlyCents > 0 && (
        <p className="text-muted-foreground text-xs tabular-nums">
          {t("summary.monthly", {
            amount: formatCents(summary.monthlyCents, locale),
          })}
        </p>
      )}
    </div>
  );
}

/** "x sur y · where · when", then the amber / mint status the old summary used to spell out. */
function GoalDetail({ view }: { view: GoalView }) {
  const t = useTranslations("settings.goals");
  const tDash = useTranslations("dashboard.goals");
  const locale = useLocale();
  const { goal, progress } = view;
  const where =
    goal.accountId === null ? t("row.manualShort") : (view.accountName ?? "");
  const when = goal.targetDate
    ? inSentence(formatMonthLabel(goal.targetDate.slice(0, 7), locale), locale)
    : t("row.noDate");
  return (
    <>
      {tDash("of", {
        saved: formatCents(progress.savedCents, locale),
        target: formatCents(goal.targetCents, locale),
      })}{" "}
      <span className="whitespace-nowrap">· {where}</span>{" "}
      <span className="whitespace-nowrap">· {when}</span>
      {progress.status === "behind" && (
        <span className="text-warning">
          {" "}
          ·{" "}
          {t("row.behind", {
            amount: formatCents(progress.behindCents, locale),
          })}
        </span>
      )}
      {progress.status === "pastDue" && (
        <span className="text-warning">
          {" "}
          ·{" "}
          {t("row.pastDue", {
            amount: formatCents(progress.remainingCents, locale),
          })}
        </span>
      )}
      {progress.status === "reached" && (
        <span className="text-positive"> · {t("row.reached")}</span>
      )}
    </>
  );
}
