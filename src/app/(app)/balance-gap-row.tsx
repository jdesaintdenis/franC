"use client";

import { ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

import { gapSentence, type BalanceGapView } from "./balance-gap";
import { BalanceGapPanel } from "./balance-gap-panel";

/**
 * A "Needs attention" row that opens the gap sheet instead of navigating. `children` is the row's
 * icon and text, rendered by the server like the other rows.
 */
export function BalanceGapRow({
  gap,
  today,
  testId,
  children,
}: {
  gap: BalanceGapView;
  today: string;
  testId: string;
  children: ReactNode;
}) {
  const t = useTranslations("dashboard.balanceGap");
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const sentence = gapSentence(t, locale, gap, today);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        data-testid={testId}
        className="hover:bg-muted/60 focus-visible:ring-ring/50 flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
      >
        {children}
        <ChevronRight className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent title={t("title")} description={sentence} data-testid="balance-gap-sheet">
        <BalanceGapPanel gap={gap} onAccepted={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
