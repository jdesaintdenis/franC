"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import { formatCents } from "@/lib/money";

import { moveBetweenGoalsAction, type GoalFormState } from "./actions";

export interface MoveTarget {
  id: string;
  name: string;
}

/** "Move to another goal": assigned money from this goal to another goal of the same account. */
export function MoveGoalForm({
  fromGoalId,
  fromName,
  holdsCents,
  targets,
  today,
  onDone,
}: {
  fromGoalId: string;
  fromName: string;
  holdsCents: number;
  targets: MoveTarget[];
  /** "YYYY-MM-DD": the default and the latest allowed date. */
  today: string;
  onDone: (amount: string, to: string) => void;
}) {
  const t = useTranslations("settings.goals.moveForm");
  const locale = useLocale();
  const [state, action, pending] = useActionState(
    async (prev: GoalFormState, formData: FormData) => {
      const result = await moveBetweenGoalsAction(prev, formData);
      if (result?.status === "ok") {
        const to =
          targets.find((target) => target.id === formData.get("toGoalId"))
            ?.name ?? "";
        onDone(String(formData.get("amount") ?? ""), to);
      }
      return result;
    },
    undefined,
  );
  const hasError = state?.status === "error";

  return (
    <form
      action={action}
      className="flex flex-col gap-3"
      aria-label={t("title", { name: fromName })}
    >
      <input type="hidden" name="fromGoalId" value={fromGoalId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`move-to-${fromGoalId}`}>{t("to")}</Label>
        <select
          id={`move-to-${fromGoalId}`}
          name="toGoalId"
          className={`${NATIVE_SELECT_CLASS} h-11`}
          defaultValue={targets[0]?.id}
        >
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`move-amount-${fromGoalId}`}>{t("amount")}</Label>
          <div className="relative">
            <Input
              id={`move-amount-${fromGoalId}`}
              name="amount"
              required
              inputMode="decimal"
              autoComplete="off"
              className="h-11 w-32 pr-7 tabular-nums"
            />
            <span
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center"
            >
              €
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`move-date-${fromGoalId}`}>{t("date")}</Label>
          <Input
            id={`move-date-${fromGoalId}`}
            name="date"
            type="date"
            required
            max={today}
            defaultValue={today}
            className="h-11"
          />
        </div>
      </div>
      <p className="text-muted-foreground text-sm">
        {t("holds", {
          name: fromName,
          amount: formatCents(holdsCents, locale),
        })}
      </p>
      {hasError && (
        <p role="alert" className="text-warning text-sm">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" pending={pending} className="h-11">
          {pending ? t("pending") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
