"use client";

import { startTransition, useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import { formatBalanceInput } from "@/lib/balance/input";
import { LOAN_NAME_MAX_LENGTH } from "@/lib/loans/input";
import { formatRateInput } from "@/lib/loans/format";
import { formatCents } from "@/lib/money";
import { addDays } from "@/lib/recurring/dates";

import { createLoanAction, updateLoanAction, type LoanFormState } from "./actions";

/** What the form starts with when editing a loan. */
export interface LoanFormDefaults {
  id: string;
  name: string;
  borrowedCents: number;
  owedCents: number;
  owedOn: string;
  rateThousandths: number;
  insuranceCents: number | null;
  insuranceRateThousandths: number | null;
  lastPaymentOn: string;
  currentPaymentUntil: string | null;
  startedOn: string | null;
  amortizationFrom: string | null;
  recurringId: string | null;
}

export interface PaymentChoice {
  id: string;
  name: string;
  typicalAmountCents: number;
}

function Field({ id, label, help, children }: { id: string; label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help && <p className="text-muted-foreground text-sm">{help}</p>}
    </div>
  );
}

function Euro({ children }: { children: React.ReactNode }) {
  return <div className="relative">{children}</div>;
}

const SUFFIX = "text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center";

/** Create (no `loan`) or edit a loan. The capital owed is the figure on the bank's table at a given date. */
export function LoanForm({
  loan,
  payments,
  today,
  onSaved,
}: {
  loan?: LoanFormDefaults;
  payments: PaymentChoice[];
  today: string;
  onSaved: (loanId: string) => void;
}) {
  const t = useTranslations("settings.loans.form");
  const locale = useLocale();
  const [insuranceMode, setInsuranceMode] = useState<"amount" | "rate">(loan?.insuranceRateThousandths != null ? "rate" : "amount");
  const [state, action, pending] = useActionState(async (prev: LoanFormState, formData: FormData) => {
    const result = await (loan ? updateLoanAction : createLoanAction)(prev, formData);
    if (result?.status === "ok" && result.loanId) onSaved(result.loanId);
    return result;
  }, undefined);
  const error = state?.status === "error" ? state.error : null;
  const insuranceDefault =
    loan?.insuranceRateThousandths != null
      ? formatRateInput(loan.insuranceRateThousandths, locale)
      : loan?.insuranceCents != null && loan.insuranceCents > 0
        ? formatBalanceInput(loan.insuranceCents, locale)
        : "";

  return (
    <form
      // A form `action` resets every field after it runs, which wipes what was typed when the save fails.
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col gap-3"
      aria-label={loan ? t("editLabel", { name: loan.name }) : t("newLabel")}
    >
      {loan && <input type="hidden" name="id" value={loan.id} />}
      <Field id="loan-name" label={t("name")}>
        <Input id="loan-name" name="name" required maxLength={LOAN_NAME_MAX_LENGTH} autoComplete="off" defaultValue={loan?.name ?? ""} placeholder={t("namePlaceholder")} className="h-11" />
      </Field>
      <Field id="loan-borrowed" label={t("borrowed")} help={t("borrowedHelp")}>
        <Euro>
          <Input id="loan-borrowed" name="borrowed" inputMode="decimal" required autoComplete="off" defaultValue={loan ? formatBalanceInput(loan.borrowedCents, locale) : ""} className="h-11 pr-7 tabular-nums" />
          <span aria-hidden className={SUFFIX}>€</span>
        </Euro>
      </Field>
      <Field id="loan-started" label={t("startedOn")} help={t("startedOnHelp")}>
        <Input id="loan-started" name="startedOn" type="date" max={today} defaultValue={loan?.startedOn ?? ""} className="h-11" />
      </Field>
      <Field id="loan-amortization" label={t("amortizationFrom")} help={t("amortizationFromHelp")}>
        <Input id="loan-amortization" name="amortizationFrom" type="date" defaultValue={loan?.amortizationFrom ?? ""} className="h-11" />
      </Field>
      <Field id="loan-owed" label={t("owed")} help={t("owedHelp")}>
        <Euro>
          <Input id="loan-owed" name="owed" inputMode="decimal" required autoComplete="off" defaultValue={loan ? formatBalanceInput(loan.owedCents, locale) : ""} className="h-11 pr-7 tabular-nums" />
          <span aria-hidden className={SUFFIX}>€</span>
        </Euro>
      </Field>
      <Field id="loan-owed-on" label={t("owedOn")}>
        <Input id="loan-owed-on" name="owedOn" type="date" required max={addDays(today, 1)} defaultValue={loan?.owedOn ?? today} className="h-11" />
      </Field>
      <Field id="loan-rate" label={t("rate")}>
        <Euro>
          <Input id="loan-rate" name="rate" inputMode="decimal" required autoComplete="off" defaultValue={loan ? formatRateInput(loan.rateThousandths, locale) : ""} className="h-11 pr-7 tabular-nums" />
          <span aria-hidden className={SUFFIX}>%</span>
        </Euro>
      </Field>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="loan-insurance">{t("insurance")}</Label>
        <div className="flex gap-2">
          <Euro>
            <Input id="loan-insurance" name="insurance" inputMode="decimal" autoComplete="off" defaultValue={insuranceDefault} className="h-11 w-28 pr-7 tabular-nums" />
            <span aria-hidden className={SUFFIX}>{insuranceMode === "amount" ? "€" : "%"}</span>
          </Euro>
          <select
            name="insuranceMode"
            aria-label={t("insuranceMode")}
            value={insuranceMode}
            onChange={(e) => setInsuranceMode(e.target.value === "rate" ? "rate" : "amount")}
            className={`${NATIVE_SELECT_CLASS} h-11 min-w-0 flex-1`}
          >
            <option value="amount">{t("insuranceAmount")}</option>
            <option value="rate">{t("insuranceRate")}</option>
          </select>
        </div>
      </div>
      <Field id="loan-last" label={t("lastPaymentOn")} help={t("lastPaymentOnHelp")}>
        <Input id="loan-last" name="lastPaymentOn" type="date" required defaultValue={loan?.lastPaymentOn ?? ""} className="h-11" />
      </Field>
      <Field id="loan-until" label={t("currentUntil")} help={t("currentUntilHelp")}>
        <Input id="loan-until" name="currentPaymentUntil" type="date" defaultValue={loan?.currentPaymentUntil ?? ""} className="h-11" />
      </Field>
      <Field id="loan-payment" label={t("paidBy")} help={payments.length === 0 ? t("paidByNone") : t("paidByHelp")}>
        <select id="loan-payment" name="recurringId" defaultValue={loan?.recurringId ?? ""} className={`${NATIVE_SELECT_CLASS} h-11`}>
          <option value="">{t("paidByLater")}</option>
          {payments.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {formatCents(p.typicalAmountCents, locale)}
            </option>
          ))}
        </select>
      </Field>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}
