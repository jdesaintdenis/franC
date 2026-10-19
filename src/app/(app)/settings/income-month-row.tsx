"use client";

import { ChevronRight, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { IncomeMonth } from "@/lib/safe-to-spend/compute";

import { IncomeMonthPicker } from "./income-month-picker";

/** The Preferences row: shows which month incoming money counts for, and opens the two choices in a sheet. */
export function IncomeMonthRow({ current }: { current: IncomeMonth }) {
  const t = useTranslations("settings.incomeMonth");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hover:bg-muted/60 active:bg-muted focus-visible:ring-ring/50 flex min-h-[52px] w-full items-center gap-3 border-t px-3.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
      >
        <span aria-hidden="true" className="bg-muted text-primary flex size-8 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-[18px]">
          <Wallet />
        </span>
        <span className="flex-1 font-semibold">{t("title")}</span>
        <span className="text-muted-foreground min-w-0 truncate text-right text-[13px]">{t(current)}</span>
        <ChevronRight className="text-muted-foreground size-[18px] shrink-0" aria-hidden="true" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title={t("title")} className="theme-50f">
          <IncomeMonthPicker current={current} />
        </SheetContent>
      </Sheet>
    </>
  );
}
