"use client";

import { useTranslations, useLocale } from "next-intl";
import { useState } from "react";

import { nextCategoryColor, subcategoryShade } from "@/lib/category-color";
import { defaultCreateParentId, optionForCreated } from "@/lib/categorize/picker-create";

import { CategoryForm } from "../settings/categories/category-form";
import type { CategoryOption } from "./sheet-types";

interface Props {
  categories: CategoryOption[];
  /** Name prefilled (the search); "" in bulk. */
  initialName: string;
  idSuffix: string;
  /** The category exists now; the caller applies it. */
  onCreated: (option: CategoryOption) => void;
}

/** Settings' create form with the picker's defaults (parent from the search, next free colour) and "Create and use". */
export function NewCategoryForm({ categories, initialName, idSuffix, onCreated }: Props) {
  const t = useTranslations("transactions.picker");
  const locale = useLocale();
  // Computed once: the page refreshes with the new category right after the create, which must not change the form.
  const [defaults] = useState(() => {
    const topLevel = categories.filter((c) => c.parentId === null);
    const parentId = defaultCreateParentId(categories, initialName);
    const parent = parentId ? topLevel.find((c) => c.id === parentId) : undefined;
    const color = parent
      ? subcategoryShade(parent.color, categories.filter((c) => c.parentId === parent.id).length)
      : nextCategoryColor(topLevel.map((c) => c.color));
    return { parentId, color };
  });
  const topLevel = categories.filter((c) => c.parentId === null);
  return (
    <CategoryForm
      mode="create"
      idSuffix={idSuffix}
      defaultName={initialName.trim()}
      autoFocusName
      parentOptions={topLevel.map((c) => ({ id: c.id, name: c.name }))}
      usedColors={categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
      defaultParentId={defaults.parentId ?? undefined}
      defaultColor={defaults.color}
      submitLabels={{ idle: t("createAndUse"), pending: t("creating") }}
      onSaved={(created) => {
        if (created) onCreated(optionForCreated(created, categories, locale));
      }}
    />
  );
}
