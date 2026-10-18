"use client";

import { ChevronRight, Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Sheet, SheetContent } from "@/components/ui/sheet";

import { LanguagePicker, type LanguageChoice } from "./language-picker";

/** The Preferences row: shows the current language, and opens the three choices in a sheet. */
export function LanguageRow({ current }: { current: LanguageChoice }) {
  const t = useTranslations("settings.language");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hover:bg-muted/60 active:bg-muted focus-visible:ring-ring/50 flex min-h-[52px] w-full items-center gap-3 px-3.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
      >
        <span aria-hidden="true" className="bg-muted text-primary flex size-8 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-[18px]">
          <Globe />
        </span>
        <span className="flex-1 font-semibold">{t("legend")}</span>
        <span lang={current === "auto" ? undefined : current} className="text-muted-foreground min-w-0 truncate text-right text-[13px]">
          {t(current)}
        </span>
        <ChevronRight className="text-muted-foreground size-[18px] shrink-0" aria-hidden="true" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title={t("legend")} className="theme-50f">
          <LanguagePicker current={current} />
        </SheetContent>
      </Sheet>
    </>
  );
}
