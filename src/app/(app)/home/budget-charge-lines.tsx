"use client";

import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { useToday } from "@/components/today-provider";
import type { BudgetCharge } from "@/lib/budgets/charges";
import { formatShortDay } from "@/lib/format-date";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/** One line per regular payment of the budget: a green tick when paid, a sand ring while expected. */
export function BudgetChargeLines({ charges }: { charges: BudgetCharge[] }) {
  const locale = useLocale();
  const t = useTranslations("dashboard.budgets");
  const today = useToday();
  if (charges.length === 0) return null;
  return (
    <ul className="col-span-full flex flex-col gap-1 pl-[42px] text-xs">
      {charges.map((charge) => {
        const date = formatShortDay(charge.date, today, locale);
        return (
          <li key={`${charge.recurringId}-${charge.date}`} className="grid grid-cols-[14px_minmax(0,1fr)_auto_auto] items-center gap-x-2">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-3.5 items-center justify-center rounded-full",
                charge.paid ? "bg-positive text-background" : "ring-sand ring-[1.5px] ring-inset",
              )}
            >
              {charge.paid && <Check className="size-2.5 stroke-[3]" />}
            </span>
            <span className="truncate">{charge.name}</span>
            <span className="text-muted-foreground">{charge.paid ? t("chargePaid", { date }) : t("chargeDue", { date })}</span>
            <span className={cn("min-w-14 text-right font-semibold tabular-nums", !charge.paid && "text-sand")}>
              {formatCents(charge.amountCents, locale)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
