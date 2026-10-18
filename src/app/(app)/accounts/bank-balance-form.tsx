"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBalanceInput } from "@/lib/balance/input";

import { setThresholdAction, type BalanceFormState } from "./actions";
import type { AccountView } from "./account-view";

/**
 * The balance of a bank-fed account: the figure and where it comes from as a read-only line, and
 * "Warn me below" as the only field. The amount and date can't be edited while the bank supplies them.
 */
export function BankBalanceForm({
  account,
  bank,
  onSaved,
}: {
  account: { id: string; name: string };
  bank: NonNullable<AccountView["bankBalance"]>;
  onSaved: () => void;
}) {
  const t = useTranslations("settings.accounts.balance");
  const locale = useLocale();
  const [state, action, pending] = useActionState(async (prev: BalanceFormState, formData: FormData) => {
    const result = await setThresholdAction(prev, formData);
    if (result?.status === "ok") onSaved();
    return result;
  }, undefined);

  const id = account.id;
  const error = state?.status === "error" ? state.error : null;
  const errorId = `balance-error-${id}`;

  return (
    <form action={action} className="flex flex-col gap-3" aria-label={t("formLabel", { name: account.name })}>
      <input type="hidden" name="id" value={id} />
      <p data-testid="bank-balance-line" className="text-sm">
        <span className="font-semibold tabular-nums">{bank.label}</span>
        <span aria-hidden="true"> · </span>
        <span className="text-muted-foreground">
          {bank.bankName !== null
            ? t("fromBank", { bank: bank.bankName, when: bank.readAt })
            : t("fromBankUnnamed", { when: bank.readAt })}
        </span>
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`balance-threshold-${id}`}>{t("threshold")}</Label>
        <div className="relative">
          <Input
            id={`balance-threshold-${id}`}
            name="threshold"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={formatBalanceInput(bank.thresholdCents, locale)}
            aria-describedby={`balance-threshold-help-${id}`}
            aria-invalid={!!error || undefined}
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
        <Button type="submit" disabled={pending} className="h-11">
          {pending ? t("saving") : t("saveThreshold")}
        </Button>
      </div>
    </form>
  );
}
