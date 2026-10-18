"use client";

import { useTranslations } from "next-intl";

import { ToastViewport } from "@/components/toast";
import { Sheet, SheetContent } from "@/components/ui/sheet";

import { BudgetForm, type BudgetFormProps } from "./budget-form";

/** The edit sheet of one category (`?edit=<id>`): its budget, or a new one when it has none. */
export function EditBudgetSheet({
  form,
  onClose,
}: {
  /** Null keeps the sheet closed. */
  form: Omit<BudgetFormProps, "onBack"> | null;
  onClose: () => void;
}) {
  const t = useTranslations("settings.budgets");
  return (
    <Sheet open={form !== null} onOpenChange={(open) => !open && onClose()}>
      {form && (
        <SheetContent title={form.existing ? t("row.edit", { name: form.category.name }) : t("add.title")} className="theme-50f min-h-[50dvh]">
          <BudgetForm key={form.category.id} {...form} />
          <ToastViewport inSheet />
        </SheetContent>
      )}
    </Sheet>
  );
}
