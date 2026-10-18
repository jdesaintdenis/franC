"use client";

import {
  useActionState,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBudgetInput } from "@/lib/budgets/input";
import { formatDay } from "@/lib/format-date";
import type { ContributionPreset } from "@/lib/goals/presets";
import { useToday } from "@/components/today-provider";
import { formatCents, formatSignedCents } from "@/lib/money";
import { networkErrorMessage } from "@/lib/offline";

import {
  addContributionAction,
  deleteContributionAction,
  type GoalFormState,
} from "./actions";

const sr = (chunks: ReactNode) => <span className="sr-only">{chunks}</span>;

export interface ContributionEntry {
  id: string;
  date: string;
  amountCents: number;
  /** Label of the moved row this entry follows (Move to savings). */
  label: string | null;
}

/**
 * "Add money" / "Take out" for a goal tracked by hand, "Assign" / "Unassign" for a goal kept in an account
 * (the wording differs, the form is the same), with the goal's latest entries.
 */
export function ContributionForm({
  goalId,
  name,
  direction,
  mode,
  hint,
  entries,
  today,
  presets = [],
  onSwitchDirection,
  onDone,
}: {
  goalId: string;
  name: string;
  /** Account goals use assign / unassign wording. */
  mode: "manual" | "assign";
  /** One line under the fields: what can be assigned, or what the goal holds. */
  hint?: string;
  /** Which of the two the sheet was opened for. */
  direction: "add" | "remove";
  entries: ContributionEntry[];
  /** "YYYY-MM-DD" in the display time zone; the default and the latest allowed date. */
  today: string;
  /** Quick amounts that fill the field. */
  presets?: ContributionPreset[];
  /** Turns the sheet around (add money <-> take it out) without closing it. */
  onSwitchDirection?: () => void;
  /** Called after the entry is saved. */
  onDone: (direction: "add" | "remove") => void;
}) {
  const t = useTranslations("settings.goals.contribution");
  const tMenu = useTranslations("settings.goals.menu");
  const [state, action, pending] = useActionState(
    async (prev: GoalFormState, formData: FormData) => {
      const result = await addContributionAction(prev, formData);
      if (result?.status === "ok") onDone(direction);
      return result;
    },
    undefined,
  );
  const locale = useLocale();
  const amountRef = useRef<HTMLInputElement>(null);
  const errorId = `contribution-error-${goalId}`;
  const hasError = state?.status === "error";

  return (
    <div className="flex flex-col gap-2">
      <form
        action={action}
        className="flex flex-col gap-2"
        aria-label={t("heading", { name })}
      >
        <input type="hidden" name="goalId" value={goalId} />
        {presets.length > 0 && (
          <div
            role="group"
            aria-label={t("presets")}
            className="flex flex-wrap gap-2"
          >
            {presets.map((preset) => (
              <button
                key={preset.kind}
                type="button"
                onClick={() => {
                  if (amountRef.current)
                    amountRef.current.value = formatBudgetInput(
                      preset.cents,
                      locale,
                    );
                  amountRef.current?.focus();
                }}
                className="bg-secondary text-secondary-foreground focus-visible:ring-ring/50 min-h-11 rounded-full border px-3.5 text-sm font-semibold tabular-nums outline-none focus-visible:ring-[3px]"
              >
                {t(
                  preset.kind === "monthly"
                    ? "presetMonthly"
                    : preset.kind === "remaining"
                      ? "presetRemaining"
                      : "presetAll",
                  {
                    amount: formatCents(preset.cents, locale),
                  },
                )}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`contribution-amount-${goalId}`}>
              {t("amount")}
            </Label>
            <div className="relative">
              <Input
                ref={amountRef}
                id={`contribution-amount-${goalId}`}
                name="amount"
                required
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={hasError || undefined}
                aria-describedby={hasError ? errorId : undefined}
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
            <Label htmlFor={`contribution-date-${goalId}`}>{t("date")}</Label>
            <Input
              id={`contribution-date-${goalId}`}
              name="date"
              type="date"
              required
              max={today}
              defaultValue={today}
              className="h-11"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            name="direction"
            value={direction}
            pending={pending}
            className="h-11"
          >
            {pending
              ? t("pending")
              : mode === "assign"
                ? t(direction === "add" ? "assign" : "unassign")
                : t(direction === "add" ? "add" : "take")}
          </Button>
          {onSwitchDirection && (
            <Button
              type="button"
              variant="ghost"
              className="h-11"
              onClick={onSwitchDirection}
            >
              {tMenu(
                mode === "manual"
                  ? direction === "add"
                    ? "takeOut"
                    : "addMoney"
                  : direction === "add"
                    ? "unassign"
                    : "assign",
              )}
            </Button>
          )}
        </div>
        {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
        {hasError && (
          <p id={errorId} role="alert" className="text-warning text-sm">
            {state.error}
          </p>
        )}
      </form>
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noEntries")}</p>
      ) : (
        <ul
          aria-label={t("historyLabel", { name })}
          className="divide-y rounded-md border text-sm"
        >
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryRow({ entry }: { entry: ContributionEntry }) {
  const t = useTranslations("settings.goals");
  const tOffline = useTranslations("settings");
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const amount = formatSignedCents(entry.amountCents, locale);
  const date = formatDay(entry.date, useToday(), locale);

  return (
    <li className="flex flex-col gap-1 px-3 py-1">
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">{date}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium tabular-nums">{amount}</span>
          {entry.label && (
            <span className="text-muted-foreground truncate text-xs">
              {entry.label}
            </span>
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              try {
                const result = await deleteContributionAction(entry.id);
                if (result.status === "error") setError(result.error);
              } catch {
                setError(
                  networkErrorMessage(
                    t("errors.removeFailed"),
                    tOffline("offline"),
                  ),
                );
              }
            })
          }
        >
          {t.rich("contribution.remove", { amount, date, sr })}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-warning pb-1 text-sm">
          {error}
        </p>
      )}
    </li>
  );
}
