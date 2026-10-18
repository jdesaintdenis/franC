"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";

import { CategoryMarker } from "@/components/category-marker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CATEGORY_PATH_SEPARATOR } from "@/lib/categorize/hierarchy";
import { formatBudgetInput } from "@/lib/budgets/input";
import type { ChargesPreset } from "@/lib/budgets/charges";
import type { BudgetPresets } from "@/lib/budgets/presets";
import { formatCents, formatWholeCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { saveBudgetAction } from "./actions";

export interface FormCategory {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
  /** Set for subcategories: they show the colour dot, never an emoji. */
  parentName?: string | null;
}

export interface BudgetFormProps {
  category: FormCategory;
  /** The category's current budget, null when it has none yet. */
  existing: { amountCents: number; rollover: boolean } | null;
  /** Carried into this month when rollover is on; null otherwise. */
  carryCents: number | null;
  presets?: BudgetPresets;
  /** This month's regular payments of the category: a pill with their total and a note naming them. */
  charges?: ChargesPreset;
  /** Field text when there is no budget yet (the average, or empty). */
  suggestedCents: number | null;
  onSaved: (result: { carryReset: boolean }) => void;
  onRemove?: () => void;
  onBack?: () => void;
}

/** The edit step shared by "Edit budget" and the second step of "Add a budget". */
export function BudgetForm({ category, existing, carryCents, presets, charges, suggestedCents, onSaved, onRemove, onBack }: BudgetFormProps) {
  const t = useTranslations("settings.budgets");
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rollover, setRollover] = useState(existing?.rollover ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = useId();
  const startCents = existing?.amountCents ?? suggestedCents;
  const defaultValue = startCents === null ? "" : formatBudgetInput(startCents, locale === "fr" ? "fr" : "en");

  // Presets are whole euros, so the field text needs no decimal separator.
  const fill = (cents: number) => {
    if (!inputRef.current) return;
    inputRef.current.value = String(cents / 100);
    setError(null);
    inputRef.current.focus();
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = inputRef.current?.value ?? "";
    // An empty field used to remove the budget; that is the Remove button's job now.
    if (amount.trim() === "") {
      setError(t("errors.invalid"));
      return;
    }
    const data = new FormData();
    data.set("categoryId", category.id);
    data.set("amount", amount);
    if (rollover) data.set("rollover", "on");
    startTransition(async () => {
      try {
        const result = await saveBudgetAction(undefined, data);
        if (result?.status === "ok") onSaved({ carryReset: result.carryReset === true });
        else setError(result?.status === "error" ? result.error : t("errors.saveFailed"));
      } catch {
        setError(t("errors.saveFailed"));
      }
    });
  }

  const carried = existing?.rollover && carryCents !== null && carryCents !== 0 ? carryCents : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="flex items-center gap-3">
        <CategoryMarker icon={category.icon} color={category.color} className="size-5 border" />
        <p className="wrap-anywhere font-semibold">
          {category.parentName ? `${category.parentName}${CATEGORY_PATH_SEPARATOR}${category.name}` : category.name}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${ids}-amount`} className="text-sm font-medium">
          {t("form.amount")}
        </label>
        <div className="relative">
          <Input
            ref={inputRef}
            id={`${ids}-amount`}
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={defaultValue}
            placeholder={t("form.placeholder")}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-error` : undefined}
            className="h-12 pr-8 text-right text-lg tabular-nums"
            onChange={() => setError(null)}
          />
          <span aria-hidden className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center">
            €
          </span>
        </div>
        {((presets && (presets.averageCents > 0 || presets.lastMonthCents > 0)) || charges) && (
          <div role="group" aria-label={t("form.presets")} className="flex flex-wrap gap-2">
            {charges && (
              <PresetChip onClick={() => fill(charges.cents)}>{t("form.charges", { amount: formatWholeCents(charges.cents, locale) })}</PresetChip>
            )}
            {presets && presets.averageCents > 0 && (
              <PresetChip onClick={() => fill(presets.averageCents)}>
                {t("form.useAverage", { amount: formatWholeCents(presets.averageCents, locale) })}
              </PresetChip>
            )}
            {presets && presets.lastMonthCents > 0 && Math.round(presets.lastMonthCents / 100) !== Math.round(presets.averageCents / 100) && (
              <PresetChip onClick={() => fill(presets.lastMonthCents)}>
                {t("form.lastMonth", { amount: formatWholeCents(presets.lastMonthCents, locale) })}
              </PresetChip>
            )}
          </div>
        )}
        {charges && (
          <p className="text-muted-foreground text-xs">
            {t("form.chargesNote", {
              amount: formatWholeCents(charges.cents, locale),
              names:
                charges.names.slice(0, 3).map((n) => t("form.chargesNoteItem", { name: n.name, day: n.day })).join(", ") +
                (charges.names.length > 3 ? "…" : ""),
            })}
          </p>
        )}
      </div>

      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={rollover}
          aria-labelledby={`${ids}-rollover`}
          aria-describedby={`${ids}-rollover-help`}
          onClick={() => setRollover((v) => !v)}
          className={cn(
            "focus-visible:ring-ring/50 relative mt-0.5 h-7 w-12 shrink-0 rounded-full border-2 outline-none transition-colors focus-visible:ring-[3px]",
            rollover ? "bg-brand border-brand" : "bg-muted border-input",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "bg-background absolute top-0.5 left-0.5 size-5 rounded-full shadow transition-transform",
              rollover && "translate-x-5",
            )}
          />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={`${ids}-rollover`} className="text-sm font-medium">
            {t("form.rollover")}
          </span>
          <span id={`${ids}-rollover-help`} className="text-muted-foreground text-sm">
            {t("form.rolloverHelp")}
          </span>
          {carried !== null && (
            <span className={cn("text-sm tabular-nums", carried > 0 ? "text-muted-foreground" : "text-warning")}>
              {t(carried > 0 ? "form.carried" : "form.carriedOverspent", { amount: formatCents(Math.abs(carried), locale) })}
            </span>
          )}
        </div>
      </div>

      {error && (
        <p id={`${ids}-error`} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Button type="submit" className="h-12" pending={pending}>
          {pending ? t("form.saving") : t("form.save")}
        </Button>
        {onBack && (
          <Button type="button" variant="ghost" className="h-12" onClick={onBack}>
            {t("add.back")}
          </Button>
        )}
        {onRemove && (
          <Button type="button" variant="ghost" className="text-warning hover:text-warning h-12" onClick={onRemove}>
            {t("form.remove")}
          </Button>
        )}
      </div>
    </form>
  );
}

function PresetChip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-input hover:bg-accent focus-visible:ring-ring/50 min-h-11 rounded-full border px-4 text-sm font-medium tabular-nums outline-none focus-visible:ring-[3px]"
    >
      {children}
    </button>
  );
}
