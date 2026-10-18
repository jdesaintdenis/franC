"use client";

import { useTranslations } from "next-intl";

import { Sheet, SheetContent } from "@/components/ui/sheet";

import { NewCategoryForm } from "./new-category-form";
import type { CategoryOption } from "./sheet-types";

/** Value of the bulk selects' last option, which opens the sheet instead of choosing a category. */
export const NEW_CATEGORY_VALUE = "__new__";

/** "New category…" from a bulk select: the picker's create form in a sheet. */
export function NewCategorySheet({
  open,
  categories,
  onClose,
  onCreated,
}: {
  open: boolean;
  categories: CategoryOption[];
  onClose: () => void;
  onCreated: (option: CategoryOption) => void;
}) {
  const t = useTranslations("transactions.picker");
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      {open && (
        <SheetContent title={t("newCategory")} className="theme-50f">
          <NewCategoryForm
            categories={categories}
            initialName=""
            idSuffix="bulk"
            onCreated={(option) => {
              onClose();
              onCreated(option);
            }}
          />
        </SheetContent>
      )}
    </Sheet>
  );
}
