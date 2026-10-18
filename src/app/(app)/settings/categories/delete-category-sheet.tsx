"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { NATIVE_CHECKBOX_CLASS } from "@/components/ui/native-select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { CategoryUsage, DeleteCategoryOption } from "@/db/queries/categories";
import { networkErrorMessage } from "@/lib/offline";

import { deleteCategoryAction } from "./actions";

interface Target {
  category: { id: string; name: string };
  usage: CategoryUsage;
}

/** The option preselected: moving into the parent for a subcategory, keeping the children for a parent. */
function defaultOption(usage: CategoryUsage): DeleteCategoryOption | undefined {
  if (usage.parent) return "move_to_parent";
  if (usage.subcategories > 0) return "keep_subcategories";
  return undefined;
}

/**
 * Shown only when something depends on the category (choice B): the choices of the old
 * dialog, in a sheet, with a Delete button. This delete has no Undo and says so.
 */
export function DeleteCategorySheet({
  target,
  onClose,
  onDeleted,
}: {
  target: Target | null;
  onClose: () => void;
  onDeleted: (name: string) => void;
}) {
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target && (
        <SheetContent className="theme-50f" title={<DeleteTitle name={target.category.name} />}>
          <DeleteBody key={target.category.id} target={target} onClose={onClose} onDeleted={onDeleted} />
        </SheetContent>
      )}
    </Sheet>
  );
}

function DeleteTitle({ name }: { name: string }) {
  const t = useTranslations("settings.categories.delete");
  return <span className="wrap-anywhere">{t("sheetTitle", { name })}</span>;
}

function DeleteBody({
  target: { category, usage },
  onClose,
  onDeleted,
}: {
  target: Target;
  onClose: () => void;
  onDeleted: (name: string) => void;
}) {
  const t = useTranslations("settings.categories.delete");
  const tSettings = useTranslations("settings");
  const [choice, setChoice] = useState<DeleteCategoryOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = choice ?? defaultOption(usage);
  const strong = (chunks: React.ReactNode) => <strong className="break-all">{chunks}</strong>;
  const plain = usage.transactions === 0 && usage.rules === 0 && usage.subcategories === 0 && !usage.parent;

  function optionLabel(option: DeleteCategoryOption): string {
    switch (option) {
      case "move_to_parent":
        return t("options.moveToParent", {
          parent: usage.parent?.name ?? "",
          transactions: usage.transactions,
          rules: usage.rules,
        });
      case "uncategorize":
        return t("options.uncategorize", { transactions: usage.transactions, rules: usage.rules });
      case "keep_subcategories":
        return t("options.keepSubcategories", { subcategories: usage.subcategories });
      case "delete_subcategories":
        return t("options.deleteSubcategories", {
          transactions: usage.subcategoryTransactions,
          rules: usage.subcategoryRules,
        });
    }
  }

  const name = category.name;
  const description = usage.parent
    ? t.rich("usageSubcategory", {
        name,
        parent: usage.parent.name,
        transactions: usage.transactions,
        rules: usage.rules,
        strong,
      })
    : usage.subcategories > 0
      ? t.rich("usageParent", {
          name,
          subcategories: usage.subcategories,
          transactions: usage.transactions,
          rules: usage.rules,
          strong,
        })
      : plain
        ? null
        : t.rich("usage", { name, transactions: usage.transactions, rules: usage.rules, strong });

  return (
    <div className="flex flex-col gap-4">
      {description && <p className="text-sm">{description}</p>}
      {(usage.budget || usage.bankMappings > 0) && <p className="text-sm">{t("attached")}</p>}
      {selected && (
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">{t("optionsLabel")}</legend>
          {(usage.parent
            ? (["move_to_parent", "uncategorize"] as const)
            : (["keep_subcategories", "delete_subcategories"] as const)
          ).map((option) => (
            <label key={option} className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="radio"
                name={`delete-option-${category.id}`}
                value={option}
                checked={selected === option}
                disabled={pending}
                onChange={() => setChoice(option)}
                className={`${NATIVE_CHECKBOX_CLASS} mt-0.5 size-4`}
              />
              <span>{optionLabel(option)}</span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="text-muted-foreground text-sm">{t("irreversible")}</p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          className="h-11"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              try {
                const result = await deleteCategoryAction(category.id, selected);
                if (result.status === "error") {
                  setError(result.error);
                  return;
                }
                onDeleted(name);
              } catch {
                setError(networkErrorMessage(t("error"), tSettings("offline")));
              }
            })
          }
        >
          {pending ? t("pending") : t("confirm")}
        </Button>
        <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={onClose}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
