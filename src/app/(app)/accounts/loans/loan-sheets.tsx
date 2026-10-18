"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBalanceInput, parseBalanceAmount } from "@/lib/balance/input";
import { formatMonthLabel, inSentence } from "@/lib/dashboard/month";
import { simulateEarlyRepayment, type ProjectionInput } from "@/lib/loans/projection";
import { formatCents } from "@/lib/money";
import { addDays } from "@/lib/recurring/dates";

import {
  addLoanCorrectionAction,
  clearLoanPaymentSplitAction,
  setLoanPaymentSplitAction,
  type LoanFormState,
} from "./actions";

const SUFFIX = "text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center";

function AmountField({ id, name, label, defaultValue, help }: { id: string; name: string; label: string; defaultValue?: string; help?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} name={name} inputMode="decimal" autoComplete="off" required defaultValue={defaultValue} className="h-11 pr-7 tabular-nums" />
        <span aria-hidden className={SUFFIX}>€</span>
      </div>
      {help && <p className="text-muted-foreground text-sm">{help}</p>}
    </div>
  );
}

function ErrorLine({ state }: { state: LoanFormState }) {
  return state?.status === "error" ? (
    <p role="alert" className="text-destructive text-sm">
      {state.error}
    </p>
  ) : null;
}

/** "The bank says I owe X at the start of this day." Becomes a correction in the loan's history. */
export function CorrectionForm({ loanId, today, onSaved }: { loanId: string; today: string; onSaved: () => void }) {
  const t = useTranslations("settings.loans.correct");
  const [state, action, pending] = useActionState(async (prev: LoanFormState, formData: FormData) => {
    const result = await addLoanCorrectionAction(prev, formData);
    if (result?.status === "ok") onSaved();
    return result;
  }, undefined);
  return (
    <form
      // Keeps the typed values when the save fails (a form `action` would reset them).
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col gap-3"
      aria-label={t("label")}
    >
      <input type="hidden" name="id" value={loanId} />
      <AmountField id="correct-owed" name="owed" label={t("owed")} help={t("owedHelp")} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="correct-on">{t("on")}</Label>
        <Input id="correct-on" name="owedOn" type="date" required max={addDays(today, 1)} defaultValue={today} className="h-11" />
      </div>
      <ErrorLine state={state} />
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}

export interface SplitPayment {
  transactionId: string;
  paidCents: number;
  interestCents: number;
  insuranceCents: number;
  corrected: boolean;
}

/** Interest and insurance of one payment; capital is what is left of what the bank took, shown live. */
export function SplitForm({ loanId, payment, onSaved }: { loanId: string; payment: SplitPayment; onSaved: () => void }) {
  const t = useTranslations("settings.loans.split");
  const locale = useLocale();
  const [interest, setInterest] = useState(formatBalanceInput(payment.interestCents, locale));
  const [insurance, setInsurance] = useState(formatBalanceInput(payment.insuranceCents, locale));
  const [resetting, startReset] = useTransition();
  const [resetError, setResetError] = useState<string | null>(null);
  const [state, action, pending] = useActionState(async (prev: LoanFormState, formData: FormData) => {
    const result = await setLoanPaymentSplitAction(prev, formData);
    if (result?.status === "ok") onSaved();
    return result;
  }, undefined);

  const cents = (value: string) => {
    const parsed = parseBalanceAmount(value);
    return parsed.ok ? (parsed.cents ?? 0) : null;
  };
  const i = cents(interest);
  const n = cents(insurance);
  const capital = i === null || n === null ? null : payment.paidCents - i - n;

  return (
    <form
      // Keeps the typed values when the save fails (a form `action` would reset them).
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col gap-3"
      aria-label={t("label")}
    >
      <input type="hidden" name="loanId" value={loanId} />
      <input type="hidden" name="transactionId" value={payment.transactionId} />
      <p className="flex justify-between text-sm">
        <span className="text-muted-foreground">{t("paid")}</span>
        <span className="font-semibold tabular-nums">{formatCents(-payment.paidCents, locale)}</span>
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="split-interest">{t("interest")}</Label>
        <div className="relative">
          <Input id="split-interest" name="interest" inputMode="decimal" autoComplete="off" required value={interest} onChange={(e) => setInterest(e.target.value)} className="h-11 pr-7 tabular-nums" />
          <span aria-hidden className={SUFFIX}>€</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="split-insurance">{t("insurance")}</Label>
        <div className="relative">
          <Input id="split-insurance" name="insurance" inputMode="decimal" autoComplete="off" required value={insurance} onChange={(e) => setInsurance(e.target.value)} className="h-11 pr-7 tabular-nums" />
          <span aria-hidden className={SUFFIX}>€</span>
        </div>
      </div>
      <p className="flex justify-between text-sm" data-testid="split-capital">
        <span className="text-muted-foreground">{t("capital")}</span>
        <span className="font-semibold tabular-nums">{capital === null ? "—" : formatCents(capital, locale)}</span>
      </p>
      <ErrorLine state={state} />
      {resetError && (
        <p role="alert" className="text-destructive text-sm">
          {resetError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || resetting} className="h-11">
          {pending ? t("saving") : t("save")}
        </Button>
        {payment.corrected && (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={pending || resetting}
            onClick={() =>
              startReset(async () => {
                setResetError(null);
                const result = await clearLoanPaymentSplitAction(loanId, payment.transactionId);
                if (result.status === "ok") onSaved();
                else setResetError(result.error);
              })
            }
          >
            {t("reset")}
          </Button>
        )}
      </div>
    </form>
  );
}

/** "What if I repaid X today?" Runs the projection in the browser: nothing is saved. */
export function Simulator({ input }: { input: ProjectionInput | null }) {
  const t = useTranslations("settings.loans.simulate");
  const locale = useLocale();
  const [value, setValue] = useState("");
  const parsed = parseBalanceAmount(value);
  const extra = parsed.ok ? (parsed.cents ?? 0) : null;
  const result = input && extra !== null && extra > 0 ? simulateEarlyRepayment(input, extra) : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="simulate-extra">{t("amount")}</Label>
        <div className="relative">
          <Input id="simulate-extra" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} className="h-11 pr-7 tabular-nums" />
          <span aria-hidden className={SUFFIX}>€</span>
        </div>
        <p className="text-muted-foreground text-sm">{t("help")}</p>
      </div>
      {extra === null && <p className="text-destructive text-sm">{t("invalid")}</p>}
      {result && (
        <dl className="bg-muted/40 flex flex-col gap-2 rounded-lg p-3 text-sm" data-testid="simulate-result">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("newEnd")}</dt>
            <dd className="font-semibold">{result.endDate ? inSentence(formatMonthLabel(result.endDate.slice(0, 7), locale), locale) : "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("monthsSaved")}</dt>
            <dd className="font-semibold">{t("months", { count: result.monthsSaved })}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("interestSaved")}</dt>
            <dd className="font-semibold tabular-nums">{formatCents(result.interestSavedCents, locale)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
