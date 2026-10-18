"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { UNCATEGORIZED } from "@/lib/recurring/list-view";

import {
  filterByCategory,
  regularTotals,
  type RecurringView,
  type ViewCategory,
} from "@/lib/recurring/list-view";
import { splitSections } from "@/lib/recurring/sections";
import { toConfirmQueue } from "@/lib/recurring/to-confirm";

import { RecurringFiltersSheet } from "./recurring-filters-sheet";
import { RecurringSections } from "./recurring-sections";
import { RecurringSheet } from "./recurring-sheet";
import { RegularHeadline } from "./regular-headline";
import { ToConfirmBlock } from "./to-confirm-block";
import { useRecurringChanges } from "./use-recurring-changes";
import type { RecurringViewItem } from "./view-item";
import { useSwipeHint } from "../transactions/use-swipe-hint";

interface Props {
  /** Every item, ended and dismissed included; the category filter is applied here so the sheet can open any of them. */
  items: RecurringViewItem[];
  view: RecurringView;
  accountId: string | null;
  categoryParents: ViewCategory[];
  chipCategories: { id: string; label: string }[];
  hasUncategorized: boolean;
  showAccount: boolean;
  /** From `?item=`, already checked against the items. */
  initialItemId: string | null;
}

/** The client half of the page: headline, the "À confirmer" block, lists and the item sheet share one optimistic list. */
export function RecurringScreen({
  items,
  view,
  accountId,
  categoryParents,
  chipCategories,
  hasUncategorized,
  showAccount,
  initialItemId,
}: Props) {
  const t = useTranslations("recurring");
  const changes = useRecurringChanges(items);
  const hint = useSwipeHint("franc:recurring-swipe-hint-dismissed");
  const tGlossary = useTranslations("common.glossary");
  const [openId, setOpenId] = useState<string | null>(initialItemId);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const shown = useMemo(
    () => filterByCategory(changes.items, view.category, categoryParents),
    [changes.items, view.category, categoryParents],
  );
  const totals = regularTotals(shown);
  const sections = splitSections(shown, view.sort);
  // Detected payments wait in their own block; the lists below hold what is confirmed.
  const queue = toConfirmQueue(sections);
  const confirmedSections = {
    ...sections,
    bills: sections.bills.filter((i) => i.status === "confirmed"),
    income: sections.income.filter((i) => i.status === "confirmed"),
  };
  const categoryName =
    view.category === null
      ? null
      : view.category === UNCATEGORIZED
        ? tGlossary("uncategorized")
        : (chipCategories.find((c) => c.id === view.category)?.label ?? null);
  const openItem = openId
    ? (changes.items.find((i) => i.id === openId) ?? null)
    : null;
  const swipeable = shown.some(
    (i) => i.status === "detected" || i.status === "confirmed",
  );

  return (
    <>
      <RegularHeadline totals={totals} />
      <ToConfirmBlock
        items={queue}
        monthlyCents={totals.detectedMonthlyOutCents}
        showAccount={showAccount}
        onOpen={(item) => setOpenId(item.id)}
        onConfirm={(item) => {
          hint.dismiss();
          changes.confirm(item);
        }}
        onDismiss={(item) => {
          hint.dismiss();
          changes.dismiss(item);
        }}
        onConfirmAll={() => changes.confirmAll(queue)}
      />
      {hint.visible && swipeable && (
        <div
          className="bg-card text-muted-foreground flex items-center gap-2 rounded-xl border py-1 pr-1 pl-4 text-sm md:hidden"
          data-testid="swipe-hint"
        >
          <p className="flex-1">{t("swipe.hint")}</p>
          <button
            type="button"
            onClick={hint.dismiss}
            aria-label={t("swipe.dismissHint")}
            className="focus-visible:ring-ring/50 flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("filters.noMatch")}</p>
      ) : (
        <RecurringSections
          sections={confirmedSections}
          monthlyInCents={totals.confirmedMonthlyInCents}
          sortLabel={
            categoryName
              ? t("filters.sortActive", { name: categoryName })
              : t("filters.sort")
          }
          onSort={() => setFiltersOpen(true)}
          showAccount={showAccount}
          onOpen={(item) => setOpenId(item.id)}
          // The row's own handlers are its swipes.
          onConfirm={(item) => {
            hint.dismiss();
            changes.confirm(item);
          }}
          onDismiss={(item) => {
            hint.dismiss();
            changes.dismiss(item);
          }}
          onResume={changes.resume}
          onRestore={changes.restore}
        />
      )}
      <RecurringFiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        view={view}
        accountId={accountId}
        categories={chipCategories}
        hasUncategorized={hasUncategorized}
      />
      <RecurringSheet
        item={openItem}
        showAccount={showAccount}
        actions={changes}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}
