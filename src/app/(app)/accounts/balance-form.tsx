"use client";

import { useActionState, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBalanceInput } from "@/lib/balance/input";
import { addDays } from "@/lib/recurring/dates";

import { clearBalanceAction, setBalanceAction, type BalanceFormState } from "./actions";

export interface AccountStartingBalance {
  cents: number;
  /** "YYYY-MM-DD" */
  date: string;
  thresholdCents: number;
}

export function BalanceForm({
  account,
  current,
  today,
  onSaved,
}: {
  account: { id: string; name: string };
  current: AccountStartingBalance | null;
  /** "YYYY-MM-DD" in the display time zone. */
  today: string;
  /** Called after the balance is saved or removed. */
  onSaved: () => void;
}) {
  const t = useTranslations("settings.accounts.balance");
  const locale = useLocale();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();
  const [state, action, pending] = useActionState(async (prev: BalanceFormState, formData: FormData) => {
    const result = await setBalanceAction(prev, formData);
    if (result?.status === "ok") onSaved();
    return result;
  }, undefined);

  const id = account.id;
  // A balance restored from the bank is the one at the end of the bank's day, so the balance at the
  // start of the day after it, which is tomorrow when the last sync ran today.
  const maxDate = addDays(today, 1);
  const error = state?.status === "error" ? state.error : removeError;
  const errorId = `balance-error-${id}`;
  const remove = () => {
    setRemoveError(null);
    startRemoving(async () => {
      const result = await clearBalanceAction(id);
      if (result.status === "ok") onSaved();
      else setRemoveError(result.error);
    });
  };

  return (
    <form action={action} className="flex flex-col gap-3" aria-label={t("formLabel", { name: account.name })}>
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`balance-amount-${id}`}>{t("amount")}</Label>
        <div className="relative">
          <Input
            id={`balance-amount-${id}`}
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            required
            defaultValue={current ? formatBalanceInput(current.cents, locale) : ""}
            placeholder={t("amountPlaceholder")}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? errorId : undefined}
            className="h-11 pr-7 tabular-nums"
          />
          <span aria-hidden className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center">
            €
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`balance-date-${id}`}>{t("date")}</Label>
        <Input
          id={`balance-date-${id}`}
          name="date"
          type="date"
          required
          max={maxDate}
          defaultValue={current?.date ?? today}
          aria-describedby={`balance-date-help-${id}`}
          className="h-11"
        />
        <p id={`balance-date-help-${id}`} className="text-muted-foreground text-sm">
          {t("dateHelp")}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`balance-threshold-${id}`}>{t("threshold")}</Label>
        <div className="relative">
          <Input
            id={`balance-threshold-${id}`}
            name="threshold"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={formatBalanceInput(current?.thresholdCents ?? 0, locale)}
            aria-describedby={`balance-threshold-help-${id}`}
            className="h-11 pr-7 tabular-nums"
          />
          <span aria-hidden className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center">
            €
          </span>
        </div>
        <p id={`balance-threshold-help-${id}`} className="text-muted-foreground text-sm">
          {t("thresholdHelp")}
        </p>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || removing} className="h-11">
          {pending ? t("saving") : t("save")}
        </Button>
        {current && (
          <Button type="button" variant="outline" className="h-11" disabled={pending || removing} onClick={remove}>
            {removing ? t("removing") : t("remove")}
          </Button>
        )}
      </div>
    </form>
  );
}
