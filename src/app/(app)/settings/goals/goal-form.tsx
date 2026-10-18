"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";

import { IconField } from "@/components/icon-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBudgetInput } from "@/lib/budgets/input";
import { GOAL_NAME_MAX_LENGTH } from "@/lib/goals/input";
import { cn } from "@/lib/utils";

import { saveGoalAction, type GoalFormState } from "./actions";

export interface GoalAccountOption {
  id: string;
  name: string;
}

export interface EditableGoal {
  id: string;
  name: string;
  targetCents: number;
  targetDate: string | null;
  icon: string | null;
  accountId: string | null;
}

export function GoalForm({
  mode,
  goal,
  accounts,
  today,
  onSaved,
  onDelete,
}: {
  mode: "create" | "edit";
  goal?: EditableGoal;
  accounts: GoalAccountOption[];
  /** "YYYY-MM-DD" in the display time zone. */
  today: string;
  /** Called after a successful save. */
  onSaved?: () => void;
  /** Edit mode: the amber "Delete goal" button at the bottom. */
  onDelete?: () => void;
}) {
  const t = useTranslations("settings.goals.form");
  const locale = useLocale();
  const [icon, setIcon] = useState(goal?.icon ?? "");
  // Where the money lives: added by hand, or kept in one of the accounts.
  const [kind, setKind] = useState<"manual" | "account">(
    goal?.accountId ? "account" : "manual",
  );
  const [accountId, setAccountId] = useState(
    goal?.accountId ?? accounts[0]?.id ?? "",
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, startSubmit] = useTransition();
  const [state, dispatch, actionPending] = useActionState(
    async (prev: GoalFormState, formData: FormData) => {
      const result = await saveGoalAction(prev, formData);
      if (result?.status === "ok") {
        // The emoji is controlled state, so the automatic form reset doesn't clear it.
        if (mode === "create") {
          setIcon("");
          formRef.current?.reset();
        }
        onSaved?.();
      }
      return result;
    },
    undefined,
  );
  const pending = actionPending || submitting;
  const suffix = goal?.id ?? "new";
  const hasError = state?.status === "error";
  const errorId = `goal-error-${suffix}`;

  return (
    <form
      ref={formRef}
      // Not `action=`: React would clear every field after a refused submit, and this form has many.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startSubmit(() => dispatch(data));
      }}
      className="flex flex-col gap-3"
    >
      {goal && <input type="hidden" name="id" value={goal.id} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`goal-name-${suffix}`}>{t("name")}</Label>
        <Input
          id={`goal-name-${suffix}`}
          name="name"
          required
          maxLength={GOAL_NAME_MAX_LENGTH}
          defaultValue={goal?.name ?? ""}
          placeholder={t("namePlaceholder")}
          autoComplete="off"
          className="h-10"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`goal-target-${suffix}`}>{t("target")}</Label>
        <div className="relative">
          <Input
            id={`goal-target-${suffix}`}
            name="target"
            required
            inputMode="decimal"
            autoComplete="off"
            defaultValue={
              goal ? formatBudgetInput(goal.targetCents, locale) : ""
            }
            placeholder={t("targetPlaceholder")}
            className="h-10 pr-7 tabular-nums"
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
        <Label htmlFor={`goal-date-${suffix}`}>{t("date")}</Label>
        <Input
          id={`goal-date-${suffix}`}
          name="date"
          type="date"
          min={mode === "create" ? today : undefined}
          defaultValue={goal?.targetDate ?? ""}
          aria-describedby={`goal-date-help-${suffix}`}
          className="h-10"
        />
        <p
          id={`goal-date-help-${suffix}`}
          className="text-muted-foreground text-sm"
        >
          {t("dateHelp")}
        </p>
      </div>
      <IconField id={`goal-icon-${suffix}`} value={icon} onChange={setIcon} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm leading-none font-medium">
          {t("source")}
        </legend>
        <input
          type="hidden"
          name="source"
          value={kind === "manual" ? "manual" : accountId}
        />
        <div
          role="radiogroup"
          aria-label={t("source")}
          className="grid grid-cols-2 gap-2"
        >
          {(["manual", "account"] as const).map((option) => {
            const disabled = option === "account" && accounts.length === 0;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                disabled={disabled}
                onClick={() => setKind(option)}
                className={cn(
                  "focus-visible:ring-ring/50 min-h-11 rounded-lg border px-3 text-sm font-semibold outline-none focus-visible:ring-[3px] disabled:opacity-50",
                  kind === option
                    ? "border-primary bg-primary/16 text-primary"
                    : "bg-secondary text-secondary-foreground",
                )}
              >
                {option === "manual" ? t("sourceManual") : t("sourceAccount")}
              </button>
            );
          })}
        </div>
        {kind === "account" && (
          <div
            role="radiogroup"
            aria-label={t("sourceAccount")}
            className="flex flex-wrap gap-2"
          >
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={accountId === a.id}
                onClick={() => setAccountId(a.id)}
                className={cn(
                  "focus-visible:ring-ring/50 min-h-11 rounded-full border px-3.5 text-sm font-semibold outline-none focus-visible:ring-[3px]",
                  accountId === a.id
                    ? "border-primary bg-primary/16 text-primary"
                    : "bg-secondary text-secondary-foreground",
                )}
              >
                {t("accountOption", { name: a.name })}
              </button>
            ))}
          </div>
        )}
        <p className="text-muted-foreground text-sm">
          {t(kind === "manual" ? "sourceHelpManual" : "sourceHelpAccount")}
        </p>
      </fieldset>
      {hasError && (
        <p id={errorId} role="alert" className="text-warning text-sm">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" pending={pending} className="h-11">
          {mode === "create"
            ? pending
              ? t("adding")
              : t("add")
            : pending
              ? t("saving")
              : t("save")}
        </Button>
        {mode === "edit" && onDelete && (
          <Button
            type="button"
            variant="ghost"
            className="text-warning h-11"
            onClick={onDelete}
          >
            {t("delete")}
          </Button>
        )}
      </div>
    </form>
  );
}
