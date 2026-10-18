"use client";

import { XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { CardFooterLink } from "@/components/row-link";
import { CategoryMarker } from "@/components/category-marker";
import { Button } from "@/components/ui/button";
import { percentShares } from "@/lib/dashboard/shares";
import { formatCents } from "@/lib/money";

import { staysOnPage, type CategorySlice } from "./category-spending";
import { useShareLabel } from "./share-label";

/**
 * Details of the active slice: amount, share, and each subcategory's share of the
 * category. Rendered outside the chart's aria-hidden wrapper so "Open" is reachable.
 */
export function CategoryDetailCard({
  slice,
  share,
  shareOf,
  onClose,
}: {
  slice: CategorySlice;
  /** Whole percent of the chart total. */
  share: number;
  /** Parent name on a subcategory breakdown; the month otherwise. */
  shareOf?: string;
  /** Shown on touch, where the selection is sticky. */
  onClose?: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("dashboard.categorySpending");
  const shareLabel = useShareLabel();
  const subs = slice.subcategories ?? [];
  const subShares = percentShares(subs.map((s) => s.spentCents));
  const percent = shareLabel(slice.spentCents, share);

  return (
    <div data-testid="category-detail" className="bg-card flex flex-col gap-3 rounded-md border p-3 text-sm">
      <div className="flex items-start gap-3">
        <CategoryMarker icon={slice.icon} color={slice.color} className="mt-1" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{slice.name}</p>
          <p className="text-muted-foreground">
            <span className="text-foreground font-medium tabular-nums">{formatCents(slice.spentCents, locale)}</span>
            {" · "}
            {shareOf ? t("shareOfCategory", { percent, category: shareOf }) : t("shareOfMonth", { percent })}
          </p>
        </div>
        {onClose && (
          <Button type="button" variant="ghost" size="icon" className="-mt-1 -mr-1 size-8" onClick={onClose} aria-label={t("close")}>
            <XIcon aria-hidden="true" />
          </Button>
        )}
      </div>
      {subs.length > 0 && (
        <ul aria-label={t("subcategories")} className="flex flex-col gap-1.5">
          {subs.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              <CategoryMarker icon={s.icon} color={s.color} className="size-2.5" />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="text-muted-foreground tabular-nums">{formatCents(s.spentCents, locale)}</span>
              <span className="w-10 text-right tabular-nums">{shareLabel(s.spentCents, subShares[i] ?? 0)}</span>
            </li>
          ))}
        </ul>
      )}
      <CardFooterLink href={slice.href} scroll={!staysOnPage(slice.href)} className="-mx-3 -mb-3">
        {t("open")}
      </CardFooterLink>
    </div>
  );
}
