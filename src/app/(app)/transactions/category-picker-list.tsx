"use client";

import { Check, ChevronLeft, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";

import { CategoryMarker } from "@/components/category-marker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canCreateFromSearch, foldName as fold } from "@/lib/categorize/picker-create";
import { cn } from "@/lib/utils";

import { NewCategoryForm } from "./new-category-form";
import type { CategoryOption } from "./sheet-types";

interface Props {
  categories: CategoryOption[];
  /** The ticked category; null ticks "Uncategorized". */
  currentId: string | null;
  /** Disables every row while a save is running. */
  pending?: boolean;
  /** `created` is set when the pick is a category just created from the search. */
  onPick: (categoryId: string | null, created?: CategoryOption) => void;
  /**
   * Set by a parent that shows the create step's heading and Back itself (the detail sheet's step
   * frame); without it the list draws its own.
   */
  creating?: boolean;
  onCreatingChange?: (creating: boolean) => void;
}

/** The searchable category list: parents with their subcategories indented, Uncategorized first. */
export function CategoryPickerList({ categories, currentId, pending = false, onPick, creating: controlledCreating, onCreatingChange }: Props) {
  const t = useTranslations("transactions.picker");
  const tGlossary = useTranslations("common.glossary");
  const [query, setQuery] = useState("");
  const [ownCreating, setOwnCreating] = useState(false);
  const controlled = controlledCreating !== undefined;
  const creating = controlledCreating ?? ownCreating;
  const setCreating = (next: boolean) => (onCreatingChange ?? setOwnCreating)(next);
  const headingId = useId();

  const visible = useMemo(() => {
    const needle = fold(query.trim());
    if (needle === "") return categories;
    const matches = (c: CategoryOption) => fold(c.name).includes(needle);
    const parentsWithMatchingChild = new Set(categories.filter((c) => c.parentId !== null && matches(c)).map((c) => c.parentId));
    const matchingParents = new Set(categories.filter((c) => c.parentId === null && matches(c)).map((c) => c.id));
    return categories.filter((c) =>
      c.parentId === null ? matchingParents.has(c.id) || parentsWithMatchingChild.has(c.id) : matches(c) || matchingParents.has(c.parentId ?? ""),
    );
  }, [categories, query]);
  const showUncategorized = query.trim() === "" || fold(tGlossary("uncategorized")).includes(fold(query.trim()));

  const offerCreate = canCreateFromSearch(
    categories.map((c) => c.name),
    query,
    [tGlossary("uncategorized")],
  );

  const rowClass =
    "hover:bg-muted focus-visible:ring-ring/50 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base outline-none focus-visible:ring-[3px] disabled:opacity-60";

  // The search state lives here, so Back returns to the list with it kept.
  if (creating && controlled) {
    return <NewCategoryForm categories={categories} initialName={query} idSuffix="picker" onCreated={(option) => onPick(option.id, option)} />;
  }
  if (creating) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <div className="-ml-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCreating(false)}
            aria-label={t("backToList")}
            className="hover:bg-accent focus-visible:ring-ring/50 flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]"
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </button>
          <h3 id={headingId} className="min-w-0 text-base font-semibold">
            {t("newCategory")}
          </h3>
        </div>
        <NewCategoryForm categories={categories} initialName={query} idSuffix="picker" onCreated={(option) => onPick(option.id, option)} />
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="picker-q" className="sr-only">
          {t("searchLabel")}
        </Label>
        <Input
          id="picker-q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-11 text-base md:text-sm"
        />
      </div>
      {!offerCreate && (
        <button
          type="button"
          disabled={pending}
          onClick={() => setCreating(true)}
          data-testid="picker-new"
          className="text-primary hover:bg-muted focus-visible:ring-ring/50 flex min-h-12 w-full items-center gap-3 rounded-xl border border-dashed px-3 text-left text-base outline-none focus-visible:ring-[3px] disabled:opacity-60"
        >
          <Plus aria-hidden="true" className="size-5 shrink-0" />
          <span className="flex-1">{t("newCategory")}</span>
        </button>
      )}
      <ul data-testid="category-picker" className="-mx-2 flex flex-col">
        {showUncategorized && (
          <li>
            <button type="button" disabled={pending} aria-current={currentId === null ? "true" : undefined} onClick={() => onPick(null)} className={rowClass}>
              <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ boxShadow: "inset 0 0 0 1px currentColor" }} />
              <span className="flex-1">{tGlossary("uncategorized")}</span>
              {currentId === null && <Check aria-hidden="true" className="size-5" />}
            </button>
          </li>
        )}
        {visible.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              disabled={pending}
              aria-current={c.id === currentId ? "true" : undefined}
              onClick={() => onPick(c.id)}
              className={cn(rowClass, c.parentId !== null && "pl-10")}
            >
              <CategoryMarker icon={c.icon} color={c.color} />
              <span className="flex-1">{c.name}</span>
              {c.id === currentId && (
                <>
                  <Check aria-hidden="true" className="size-5" />
                  <span className="sr-only">{t("current")}</span>
                </>
              )}
            </button>
          </li>
        ))}
        {visible.length === 0 && !showUncategorized && <li className="text-muted-foreground px-3 py-4 text-sm">{t("noResults", { query: query.trim() })}</li>}
        {offerCreate && (
          <li>
            <button type="button" disabled={pending} onClick={() => setCreating(true)} className={rowClass} data-testid="picker-create">
              <Plus aria-hidden="true" className="size-5 shrink-0" />
              <span className="flex-1">{t("create", { name: query.trim() })}</span>
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
