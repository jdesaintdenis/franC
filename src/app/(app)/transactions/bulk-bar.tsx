"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NoCategoriesHint } from "@/components/no-categories-hint";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import type { CategoryOption } from "@/lib/categorize/hierarchy";
import { NEW_CATEGORY_VALUE, NewCategorySheet } from "./new-category-sheet";
import { MAX_TAG_LENGTH } from "@/lib/tags/validate";
import { cn } from "@/lib/utils";

interface Props {
  count: number;
  categories: CategoryOption[];
  /** The user's tag names, suggested while typing. */
  tagNames: string[];
  /** Tags carried by the selected loaded rows: what "Remove tag" can pick from. */
  selectedTags: { id: string; name: string }[];
  pending: boolean;
  /** `null` clears the category of the selected transactions. */
  onApply: (categoryId: string | null, created?: CategoryOption) => void;
  onAddTag: (name: string) => void;
  onRemoveTag: (tagId: string) => void;
}

type Mode = "category" | "tag";

/** Fixed just above the bottom nav (about 4rem plus the safe area). */
export function BulkBar({ count, categories, tagNames, selectedTags, pending, onApply, onAddTag, onRemoveTag }: Props) {
  const t = useTranslations("transactions.bulk");
  const [mode, setMode] = useState<Mode>("category");
  const [categoryId, setCategoryId] = useState("");
  const [creating, setCreating] = useState(false);
  const [tagName, setTagName] = useState("");
  const [removeId, setRemoveId] = useState("");
  const listId = useId();
  const disabled = pending || count === 0;
  // The chosen tag may have left the selection (rows were deselected).
  const removeChoice = selectedTags.some((tag) => tag.id === removeId) ? removeId : "";

  // z-[60] and bottom-0: it covers the tab bar and its raised "+" while selecting, so nothing sits on the buttons.
  return (
    <section
      aria-label={t("barLabel")}
      className="theme-50f bg-card fixed inset-x-0 bottom-0 z-[60] border-t pb-[env(safe-area-inset-bottom)] shadow-lg lg:left-60"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 py-2 md:px-8">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium" aria-live="polite">
            {t("selected", { count })}
          </p>
          {/* One mode at a time keeps the fixed bar short on a phone. */}
          <div role="group" aria-label={t("modeLabel")} className="flex gap-1">
            {(["category", "tag"] as const).map((m) => (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={mode === m ? "default" : "outline"}
                aria-pressed={mode === m}
                className={cn("min-h-9")}
                onClick={() => setMode(m)}
              >
                {t(m === "category" ? "modeCategory" : "modeTag")}
              </Button>
            ))}
          </div>
        </div>
        {mode === "category" &&
          (categories.length === 0 ? (
            <NoCategoriesHint />
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="bulk-category" className="sr-only">
                  {t("categoryLabel")}
                </Label>
                <select
                  id="bulk-category"
                  value={categoryId}
                  onChange={(e) => (e.target.value === NEW_CATEGORY_VALUE ? setCreating(true) : setCategoryId(e.target.value))}
                  disabled={pending}
                  className={`${NATIVE_SELECT_CLASS} h-11`}
                >
                  <option value="">{t("chooseCategory")}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                  <option value={NEW_CATEGORY_VALUE}>{t("newCategory")}</option>
                </select>
              </div>
              <div className="flex gap-2">
                <Button type="button" className="h-11 flex-1" disabled={disabled || categoryId === ""} onClick={() => onApply(categoryId)}>
                  {t("apply")}
                </Button>
                <Button type="button" variant="outline" className="h-11 flex-1" disabled={disabled} onClick={() => onApply(null)}>
                  {t("clearCategory")}
                </Button>
              </div>
            </div>
          ))}
        {mode === "tag" && (
          <div className="flex flex-col gap-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!disabled && tagName.trim() !== "") onAddTag(tagName);
              }}
            >
              <Label htmlFor="bulk-tag-name" className="sr-only">
                {t("tagNameLabel")}
              </Label>
              <Input
                id="bulk-tag-name"
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                list={listId}
                placeholder={t("tagPlaceholder")}
                maxLength={MAX_TAG_LENGTH * 2}
                autoComplete="off"
                disabled={pending}
                className="h-11 min-w-0 flex-1 text-base md:text-sm"
              />
              <datalist id={listId}>
                {tagNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <Button type="submit" className="h-11" disabled={disabled || tagName.trim() === ""}>
                {t("addTag")}
              </Button>
            </form>
            <div className="flex gap-2">
              <Label htmlFor="bulk-tag-remove" className="sr-only">
                {t("removeTagLabel")}
              </Label>
              <select
                id="bulk-tag-remove"
                value={removeChoice}
                onChange={(e) => setRemoveId(e.target.value)}
                disabled={pending || selectedTags.length === 0}
                className={`${NATIVE_SELECT_CLASS} h-11 min-w-0 flex-1`}
              >
                <option value="">{selectedTags.length === 0 ? t("noTagsSelected") : t("chooseTag")}</option>
                {selectedTags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" className="h-11" disabled={disabled || removeChoice === ""} onClick={() => onRemoveTag(removeChoice)}>
                {t("removeTag")}
              </Button>
            </div>
          </div>
        )}
      </div>
      <NewCategorySheet open={creating} categories={categories} onClose={() => setCreating(false)} onCreated={(option) => onApply(option.id, option)} />
    </section>
  );
}
