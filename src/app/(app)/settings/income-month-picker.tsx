"use client";

import { CalendarDays } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { useToast } from "@/components/toast";
import { NATIVE_CHECKBOX_CLASS } from "@/components/ui/native-select";
import type { IncomeMonth } from "@/lib/safe-to-spend/compute";

import { setIncomeMonth } from "./income-month-actions";

const CHOICES: readonly IncomeMonth[] = ["next", "this"];

export function IncomeMonthPicker({ current }: { current: IncomeMonth }) {
  const t = useTranslations("settings.incomeMonth");
  const tToast = useTranslations("common.toast");
  const toast = useToast();
  const router = useRouter();
  const [selected, setSelected] = useState<IncomeMonth>(current);
  const [pending, startTransition] = useTransition();

  function choose(choice: IncomeMonth) {
    if (pending || choice === selected) return;
    const previous = selected;
    setSelected(choice);
    // The number on Home changing is the feedback; only a failure says anything, as a toast.
    const failed = () => {
      setSelected(previous);
      toast.show({ message: t("error"), variant: "error", action: { label: tToast("retry"), onAction: () => choose(choice) } });
    };
    startTransition(async () => {
      try {
        const result = await setIncomeMonth(choice);
        if (result.status === "error") return failed();
        router.refresh();
      } catch {
        failed();
      }
    });
  }

  return (
    <fieldset aria-busy={pending} className="flex flex-col gap-3">
      <legend className="text-muted-foreground mb-3 text-sm">{t("intro")}</legend>
      <div className="divide-y rounded-[10px] border">
        {CHOICES.map((choice) => (
          <label key={choice} className="hover:bg-accent flex min-h-14 cursor-pointer items-start gap-3 px-3.5 py-3.5">
            <input
              type="radio"
              name="income-month"
              value={choice}
              checked={selected === choice}
              onChange={() => choose(choice)}
              className={`${NATIVE_CHECKBOX_CLASS} mt-0.5 size-5`}
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                {t(choice)}
                {choice === "next" && (
                  <span className="bg-brand-soft text-primary rounded-full px-2 py-0.5 text-[11px] font-bold">{t("recommended")}</span>
                )}
              </span>
              <span className="text-muted-foreground text-[13px] leading-snug">{t(`${choice}Hint`)}</span>
              {choice === "next" && (
                <span className="text-muted-foreground flex items-center gap-1.5 text-[13px]">
                  <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
                  {t("nextFor")}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
