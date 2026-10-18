"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/** Budgets the regular payments fill, folded away: they have nothing left to decide. */
export function ChargesOnlyFold({ count, summary, children }: { count: number; summary: string; children: ReactNode }) {
  const t = useTranslations("dashboard.budgets");
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1" data-testid="charges-only-fold">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-primary focus-visible:ring-ring/50 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md text-sm font-semibold outline-none focus-visible:ring-[3px]"
      >
        {open ? t("chargesOnlyHide") : t("chargesOnlyShow", { count })}
        <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {!open && <p className="text-muted-foreground text-center text-xs">{summary}</p>}
      {open && (
        <>
          <h3 className="font-title text-muted-foreground pt-2 text-[11px] font-semibold tracking-[0.14em] uppercase">
            {t("chargesOnlyHeading")}
          </h3>
          {children}
        </>
      )}
    </div>
  );
}
