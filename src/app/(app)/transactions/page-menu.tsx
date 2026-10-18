"use client";

import { CheckCheck, Download, ListChecks, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";

import { useSelectionMode } from "./selection-context";

const ITEM =
  "hover:bg-muted focus-visible:ring-ring/50 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-medium outline-none focus-visible:ring-[3px]";

/** The header's one action: a ⋯ button opening Select and Export CSV (each only when there are rows). */
export function PageMenu({ canSelect, exportHref, showReviewScreen }: { canSelect: boolean; exportHref: string | null; showReviewScreen: boolean }) {
  const t = useTranslations("transactions");
  const tBulk = useTranslations("transactions.bulk");
  const { setSelectionMode } = useSelectionMode();
  if (!canSelect && !exportHref && !showReviewScreen) return null;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={t("menu.label")}
          data-testid="page-menu"
          className="hover:bg-muted focus-visible:ring-ring/50 flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]"
        >
          <MoreHorizontal className="size-6" aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent title={t("menu.title")} className="theme-50f">
        <div className="-mx-2 flex flex-col">
          {canSelect && (
            <SheetClose asChild>
              <button type="button" className={ITEM} onClick={() => setSelectionMode(true)}>
                <ListChecks className="text-muted-foreground size-5" aria-hidden="true" />
                {tBulk("select")}
              </button>
            </SheetClose>
          )}
          {showReviewScreen && (
            <SheetClose asChild>
              <Link href="/review" data-testid="menu-review-screen" className={ITEM}>
                <CheckCheck className="text-muted-foreground size-5" aria-hidden="true" />
                {t("menu.reviewScreen")}
              </Link>
            </SheetClose>
          )}
          {exportHref && (
            <SheetClose asChild>
              {/* A file download, so a plain anchor: next/link would try a client navigation. */}
              <a href={exportHref} download className={ITEM}>
                <Download className="text-muted-foreground size-5" aria-hidden="true" />
                {t("exportCsv")}
              </a>
            </SheetClose>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
