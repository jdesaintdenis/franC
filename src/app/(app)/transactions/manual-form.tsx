"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import { MANUAL_LABEL_MAX } from "@/lib/manual/input";
import { cn } from "@/lib/utils";

import type { ManualErrorCode } from "./manual-actions";

export interface ManualFormValues {
  direction: "expense" | "income";
  /** What the user typed, e.g. "12,50". */
  amount: string;
  label: string;
  /** "YYYY-MM-DD". */
  date: string;
  accountId: string;
}

/** The field a failure belongs to, so it can be marked invalid. */
function fieldOf(error: ManualErrorCode | null): "amount" | "label" | "date" | null {
  if (error === null) return null;
  if (error.startsWith("amount")) return "amount";
  if (error.startsWith("label")) return "label";
  if (error.startsWith("date")) return "date";
  return null;
}

/**
 * The fields of "Add a transaction" and "Edit": Expense / Income, amount, label, date, and (when
 * given) the account and a category row that opens the picker. Validation is the server's; this only
 * collects the values and shows the code it gets back.
 */
export function ManualForm({
  values,
  onChange,
  accounts,
  categoryLabel,
  onChooseCategory,
  today,
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  /** Controlled, so a parent can keep the values while another step (the category picker) is shown. */
  values: ManualFormValues;
  onChange: (values: ManualFormValues) => void;
  /** Current accounts to choose from; the select shows only with two or more. */
  accounts?: { id: string; name: string }[];
  /** The picked category's name, or null for none. Omit with `onChooseCategory` to hide the row. */
  categoryLabel?: string | null;
  onChooseCategory?: () => void;
  today: string;
  submitLabel: string;
  pending: boolean;
  error: ManualErrorCode | null;
  onSubmit: (values: ManualFormValues) => void;
}) {
  const t = useTranslations("transactions.add");
  const id = useId();
  const errorId = `${id}-error`;
  const invalid = fieldOf(error);
  const set = <K extends keyof ManualFormValues>(key: K, value: ManualFormValues[K]) =>
    onChange({ ...values, [key]: value });

  const segment = (value: ManualFormValues["direction"], label: string, testId: string) => (
    <button
      type="button"
      aria-pressed={values.direction === value}
      data-testid={testId}
      onClick={() => set("direction", value)}
      className={cn(
        "focus-visible:ring-ring/50 h-11 flex-1 rounded-lg text-base font-medium outline-none focus-visible:ring-[3px]",
        values.direction === value ? "bg-background shadow-xs" : "text-muted-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      <div role="group" aria-label={t("direction")} className="bg-muted flex gap-1 rounded-xl p-1">
        {segment("expense", t("expense"), "add-expense")}
        {segment("income", t("income"), "add-income")}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-amount`}>{t("amount")}</Label>
        <div className="relative">
          <Input
            id={`${id}-amount`}
            data-testid="add-amount"
            value={values.amount}
            onChange={(e) => set("amount", e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            required
            aria-invalid={invalid === "amount" || undefined}
            aria-describedby={invalid === "amount" ? errorId : undefined}
            className="h-11 pr-7 tabular-nums"
          />
          <span aria-hidden className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center">
            €
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-label`}>{t("label")}</Label>
        <Input
          id={`${id}-label`}
          data-testid="add-label"
          value={values.label}
          onChange={(e) => set("label", e.target.value)}
          placeholder={t("labelPlaceholder")}
          autoComplete="off"
          required
          maxLength={MANUAL_LABEL_MAX * 2}
          aria-invalid={invalid === "label" || undefined}
          aria-describedby={invalid === "label" ? errorId : undefined}
          className="h-11"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-date`}>{t("date")}</Label>
        <Input
          id={`${id}-date`}
          data-testid="add-date"
          type="date"
          value={values.date}
          onChange={(e) => set("date", e.target.value)}
          max={today}
          min="2000-01-01"
          required
          aria-invalid={invalid === "date" || undefined}
          aria-describedby={invalid === "date" ? errorId : undefined}
          className="h-11"
        />
      </div>

      {accounts && accounts.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-account`}>{t("account")}</Label>
          <select
            id={`${id}-account`}
            data-testid="add-account"
            value={values.accountId}
            onChange={(e) => set("accountId", e.target.value)}
            className={cn(NATIVE_SELECT_CLASS, "h-11")}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {onChooseCategory && (
        <button
          type="button"
          data-testid="add-category"
          onClick={onChooseCategory}
          className="hover:bg-muted focus-visible:ring-ring/50 -mx-3 flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-base outline-none focus-visible:ring-[3px]"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-muted-foreground text-sm">{t("category")}</span>
            <span className="truncate font-medium">{categoryLabel ?? t("noCategory")}</span>
          </span>
          <ChevronRight aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
        </button>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {t(`errors.${error}`, { max: MANUAL_LABEL_MAX })}
        </p>
      )}

      <Button type="submit" data-testid="add-submit" pending={pending} className="h-11">
        {submitLabel}
      </Button>
    </form>
  );
}
