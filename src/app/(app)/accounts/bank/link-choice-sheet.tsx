"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type ChoiceOption = { value: string; label: string; disabled?: boolean };

/** "franC account" sheet: which account one bank account feeds. Choosing a row closes the sheet. */
export function LinkChoiceSheet({
  open,
  onOpenChange,
  bankAccount,
  options,
  value,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "{name} ••{last4}" of the bank account being linked. */
  bankAccount: string;
  options: ChoiceOption[];
  value: string;
  onChoose: (value: string) => void;
}) {
  const t = useTranslations("settings.bankConnection.link");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="theme-50f" title={t("sheetTitle")} description={t("sheetDescription", { name: bankAccount })}>
        <div role="radiogroup" aria-label={t("sheetTitle")} className="divide-border bg-card divide-y overflow-hidden rounded-[10px] border">
          {options.map((option) => {
            const on = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={option.disabled}
                onClick={() => {
                  onChoose(option.value);
                  onOpenChange(false);
                }}
                className={cn(
                  "focus-visible:ring-ring/50 flex min-h-[52px] w-full items-center justify-between gap-3 px-3.5 text-left outline-none focus-visible:ring-[3px] disabled:opacity-50",
                  on ? "text-primary font-bold" : "font-semibold",
                )}
              >
                <span className="wrap-anywhere">{option.label}</span>
                {on && <Check className="size-4 shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
