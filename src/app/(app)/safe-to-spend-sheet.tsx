"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

/**
 * The only client part of the hero: the trigger and the sheet. The breakdown itself is rendered
 * on the server and passed in as children.
 */
export function SafeToSpendSheet({
  triggerLabel,
  title,
  description,
  children,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Sheet>
      <SheetTrigger className="text-primary -my-2 inline-flex min-h-11 items-center gap-0.5 rounded-md py-2 text-[13px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-primary/70">
        {triggerLabel}
        <ChevronRight className="size-4" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent title={title} description={description} className="theme-50f" data-testid="safe-to-spend-breakdown">
        {children}
      </SheetContent>
    </Sheet>
  );
}
