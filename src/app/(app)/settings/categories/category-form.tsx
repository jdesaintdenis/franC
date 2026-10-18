"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_CATEGORY_NAME } from "@/lib/categorize/schemas";
import { CATEGORY_PALETTE, parseHexColor } from "@/lib/category-color";
import { formattingLocale } from "@/i18n/config";

import { IconField } from "@/components/icon-field";
import { ColorField } from "./color-field";
import {
  createCategoryAction,
  updateCategoryAction,
  type CategoryFormState,
  type CreatedCategory,
} from "./actions";

export interface ParentOption {
  id: string;
  name: string;
}

export function CategoryForm({
  mode,
  category,
  parentOptions,
  usedColors,
  defaultParentId,
  hasSubcategories = false,
  defaultColor = CATEGORY_PALETTE[0],
  defaultName,
  autoFocusName = false,
  submitLabels,
  idSuffix,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  category?: {
    id: string;
    name: string;
    color: string;
    icon?: string | null;
    parentId?: string | null;
  };
  /** Top-level categories that can be picked as parent. */
  parentOptions: ParentOption[];
  /** Every category and its colour, to point out a colour that is already taken. */
  usedColors: { id: string; name: string; color: string }[];
  /** Preselected parent when creating (the "Add subcategory" action). */
  defaultParentId?: string;
  /** A category with subcategories can't become a subcategory itself. */
  hasSubcategories?: boolean;
  /** Proposed colour when creating: the next unused palette colour, or a shade of the parent's. */
  defaultColor?: string;
  /** Name prefilled when creating (the picker's search, Slice 54). */
  defaultName?: string;
  /** Focus the name on mount so a phone opens the keyboard. */
  autoFocusName?: boolean;
  /** Replaces "Add category" / "Adding…". */
  submitLabels?: { idle: string; pending: string };
  /** Keeps field ids apart from a Settings form on the same page. */
  idSuffix?: string;
  /** Called after the category was created or saved (the sheet closes and a toast shows). */
  onSaved?: (created?: CreatedCategory) => void;
  /** Shows a Cancel button; leave undefined where the sheet's own close button is enough. */
  onCancel?: () => void;
}) {
  const t = useTranslations("settings.categories.form");
  const [icon, setIcon] = useState(category?.icon ?? "");
  const locale = useLocale();
  const initialColor = category?.color ?? defaultColor;
  const [colorDraft, setColorDraft] = useState(initialColor);
  // Last valid colour: what the native picker shows while the text field is mid-edit.
  const [swatch, setSwatch] = useState(initialColor);
  const [parentId, setParentId] = useState(
    category?.parentId ?? defaultParentId ?? "",
  );
  const [state, action, pending] = useActionState(
    async (prev: CategoryFormState, formData: FormData) => {
      let result: CategoryFormState;
      try {
        result =
          mode === "create"
            ? await createCategoryAction(prev, formData)
            : await updateCategoryAction(prev, formData);
      } catch {
        // Offline or the request died: the server never answered, so say it here instead of the error boundary.
        return {
          status: "error" as const,
          error: mode === "create" ? t("addError") : t("saveError"),
        };
      }
      if (result?.status === "ok") {
        // The hidden input is controlled, so the form's automatic reset doesn't clear it.
        if (mode === "create") {
          setIcon("");
          setColorDraft(defaultColor);
          setSwatch(defaultColor);
          setParentId(defaultParentId ?? "");
        }
        onSaved?.(result.category);
      }
      return result;
    },
    undefined,
  );
  const suffix =
    idSuffix ??
    category?.id ??
    (defaultParentId ? `sub-${defaultParentId}` : "new");
  const hasError = state?.status === "error";
  const errorId = `category-error-${suffix}`;
  const parentLocked = mode === "edit" && hasSubcategories;
  const parentHintId = `parent-hint-${suffix}`;
  const parents = parentOptions.filter((p) => p.id !== category?.id);
  const draftHex = parseHexColor(colorDraft);
  const takenBy = draftHex
    ? usedColors
        .filter(
          (c) => c.id !== category?.id && c.color.toLowerCase() === draftHex,
        )
        .map((c) => c.name)
    : [];
  const colorHintId = `color-hint-${suffix}`;
  const colorHint =
    draftHex === null
      ? t("colorHexHint")
      : takenBy.length > 0
        ? t("colorUsedBy", {
            names: new Intl.ListFormat(formattingLocale(locale), {
              style: "long",
              type: "conjunction",
            }).format(takenBy),
          })
        : null;

  return (
    <form action={action} className="flex flex-col gap-3">
      {category && <input type="hidden" name="id" value={category.id} />}
      <div className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`name-${suffix}`}>{t("name")}</Label>
          <Input
            id={`name-${suffix}`}
            name="name"
            required
            maxLength={MAX_CATEGORY_NAME}
            defaultValue={category?.name ?? defaultName ?? ""}
            autoFocus={autoFocusName}
            className="h-10"
            aria-invalid={hasError || undefined}
            aria-describedby={hasError ? errorId : undefined}
          />
        </div>
        <IconField id={`icon-${suffix}`} value={icon} onChange={setIcon} />
      </div>
      <ColorField
        suffix={suffix}
        value={colorDraft}
        swatch={swatch}
        onChange={(value) => {
          setColorDraft(value);
          const hex = parseHexColor(value);
          if (hex) setSwatch(hex);
        }}
        usedColors={usedColors}
        categoryId={category?.id}
        hint={colorHint}
        hintId={colorHintId}
      />
      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={parentLocked ? parentHintId : undefined}
      >
        <legend className="mb-2 text-sm leading-none font-medium">
          {t("parent")}
        </legend>
        {/* A locked parent is not submitted, so parentId stays unchanged on the server. */}
        {!parentLocked && (
          <input type="hidden" name="parentId" value={parentId} />
        )}
        <div
          role="radiogroup"
          aria-label={t("parent")}
          className="flex flex-wrap gap-2"
        >
          {[{ id: "", name: t("parentNone") }, ...parents].map((p) => (
            <label key={p.id || "none"} className="has-[:disabled]:opacity-50">
              <input
                type="radio"
                name={`parent-pill-${suffix}`}
                className="peer sr-only"
                checked={parentId === p.id}
                disabled={parentLocked}
                onChange={() => setParentId(p.id)}
              />
              <span className="bg-secondary text-secondary-foreground peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-ring/50 flex min-h-10 cursor-pointer items-center rounded-full px-3.5 text-sm font-semibold peer-focus-visible:ring-[3px]">
                {p.name}
              </span>
            </label>
          ))}
        </div>
        {parentLocked && (
          <p id={parentHintId} className="text-muted-foreground text-sm">
            {t("parentLockedHint")}
          </p>
        )}
      </fieldset>
      {state?.status === "error" && (
        <p id={errorId} role="alert" className="text-warning text-sm">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" pending={pending} className="h-10">
          {mode === "create"
            ? pending
              ? (submitLabels?.pending ?? t("adding"))
              : (submitLabels?.idle ?? t("add"))
            : pending
              ? t("saving")
              : t("save")}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={pending}
            onClick={onCancel}
          >
            {t("cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
