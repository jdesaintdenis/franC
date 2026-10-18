"use client";

import { useTranslations } from "next-intl";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { TransactionListItem } from "@/db/queries/transactions";

import { CategoryPickerList } from "./category-picker-list";
import type { CategoryOption } from "./sheet-types";

interface Props {
  /** The transaction being recategorized; null keeps the sheet closed. */
  item: TransactionListItem | null;
  /** The name shown on the row, for the sheet's description. */
  itemName: string;
  categories: CategoryOption[];
  onClose: () => void;
  /** The chosen category (null clears it). The sheet has already asked to close; the parent saves. */
  onPick: (item: TransactionListItem, categoryId: string | null, created?: CategoryOption) => void;
}

/** The swipe-right sheet: search the categories and tap one to apply it (manual, like the detail sheet). It closes at once; the parent saves in the background. */
export function CategoryPickerSheet({ item, itemName, categories, onClose, onPick }: Props) {
  const t = useTranslations("transactions.picker");
  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent title={t("title")} description={itemName} className="theme-50f min-h-[60dvh]">
        {item && <PickerBody
            key={item.id}
            item={item}
            categories={categories}
            onPick={(picked, categoryId, created) => {
              onClose();
              onPick(picked, categoryId, created);
            }}
          />}
      </SheetContent>
    </Sheet>
  );
}

function PickerBody({ item, categories, onPick }: { item: TransactionListItem; categories: CategoryOption[]; onPick: Props["onPick"] }) {
  // No waiting here: the parent changes the row, shows the toast and saves behind it.
  return <CategoryPickerList categories={categories} currentId={item.category?.id ?? null} onPick={(categoryId, created) => onPick(item, categoryId, created)} />;
}
