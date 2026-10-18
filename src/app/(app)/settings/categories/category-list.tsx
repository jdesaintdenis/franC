"use client";

import {
  FolderPlus,
  PiggyBank,
  Pencil,
  Plus,
  Tags,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { ListRowTransition } from "@/components/list-row-transition";
import { CategoryMarker } from "@/components/category-marker";
import { EmptyState } from "@/components/empty-state";
import { EmptyAddLink } from "@/components/manage/empty-add-link";
import { ManageRow } from "@/components/manage/manage-row";
import type { RowMenuItem } from "@/components/manage/row-menu";
import { useSheetParam } from "@/components/manage/use-sheet-param";
import { useToast } from "@/components/toast";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { CategorySnapshot, CategoryUsage } from "@/db/queries/categories";
import { categoryDisplayColor, subcategoryShade } from "@/lib/category-color";
import { formatCents } from "@/lib/money";
import { networkErrorMessage } from "@/lib/offline";

import { restoreCategoryAction, tryDeleteCategoryAction } from "./actions";
import { CategoryForm } from "./category-form";
import { DeleteCategorySheet } from "./delete-category-sheet";

interface Item {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  parentId: string | null;
}

export function CategoryList({
  tree,
  spending,
  budgeted,
  defaultColor,
}: {
  tree: { category: Item; children: Item[] }[];
  /** This month's spending in cents per category id, parents rolled up. */
  spending: Record<string, number>;
  /** Ids of the categories that have a budget. */
  budgeted: string[];
  defaultColor: string;
}) {
  const t = useTranslations("settings.categories");
  const tOffline = useTranslations("settings");
  const locale = useLocale();
  const toast = useToast();
  const sheet = useSheetParam();
  // "Add a subcategory" needs a parent next to the add flag, so it lives in state, not the URL.
  const [addSubTo, setAddSubTo] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState<{
    category: Item;
    usage: CategoryUsage;
  } | null>(null);

  const parentOptions = tree.map(({ category }) => ({
    id: category.id,
    name: category.name,
  }));
  const all = tree.flatMap(({ category, children }) => [category, ...children]);
  const usedColors = all.map(({ id, name, color }) => ({ id, name, color }));
  const editing = sheet.editing
    ? (all.find((c) => c.id === sheet.editing) ?? null)
    : null;
  const editingChildren = editing
    ? (tree.find((n) => n.category.id === editing.id)?.children.length ?? 0)
    : 0;

  function saved(message: string) {
    sheet.close();
    setAddSubTo(null);
    toast.show({ message });
  }

  async function undo(snapshot: CategorySnapshot) {
    try {
      const result = await restoreCategoryAction(snapshot);
      if (result?.status === "error")
        toast.show({ message: result.error, variant: "error" });
      else
        toast.show({ message: t("toast.restored", { name: snapshot.name }) });
    } catch {
      toast.show({
        message: networkErrorMessage(
          tOffline("manage.undoFailed"),
          tOffline("offline"),
        ),
        variant: "error",
      });
    }
  }

  async function remove(category: Item) {
    try {
      const result = await tryDeleteCategoryAction(category.id);
      if (result.status === "deleted") {
        toast.show({
          message: t("toast.deleted", { name: category.name }),
          undo: { onUndo: () => undo(result.snapshot) },
        });
      } else if (result.status === "in_use") {
        setDeleting({ category, usage: result.usage });
      } else {
        toast.show({ message: result.error, variant: "error" });
      }
    } catch {
      toast.show({
        message: networkErrorMessage(
          tOffline("manage.deleteFailed"),
          tOffline("offline"),
        ),
        variant: "error",
      });
    }
  }

  function menuFor(category: Item, topLevel: boolean): RowMenuItem[] {
    return [
      {
        label: t("menu.edit"),
        icon: <Pencil className="size-4" aria-hidden="true" />,
        onSelect: () => sheet.openEdit(category.id),
      },
      ...(topLevel
        ? [
            {
              label: t("menu.addSubcategory"),
              icon: <FolderPlus className="size-4" aria-hidden="true" />,
              onSelect: () => setAddSubTo(category),
            },
          ]
        : []),
      {
        label: t("menu.setBudget"),
        icon: <PiggyBank className="size-4" aria-hidden="true" />,
        href: `/settings/budgets?edit=${category.id}`,
      },
      {
        label: tOffline("manage.delete"),
        icon: <Trash2 className="size-4" aria-hidden="true" />,
        destructive: true,
        onSelect: () => void remove(category),
      },
    ];
  }

  // A category that spent nothing shows no figure: "0 €" on every row is noise.
  const spent = (id: string) =>
    (spending[id] ?? 0) > 0 ? (
      <span className="text-muted-foreground text-xs">
        {formatCents(spending[id], locale)}
      </span>
    ) : undefined;
  const menuLabel = (name: string) => tOffline("manage.options", { name });

  return (
    <>
      {tree.length === 0 ? (
        <EmptyState
          icon={Tags}
          title={t("empty.title")}
          body={t("empty.body")}
          action={<EmptyAddLink label={t("empty.action")} />}
        />
      ) : (
        <ul aria-label={t("listLabel")} className="flex flex-col gap-2.5">
          {tree.map(({ category, children }) => (
            <ListRowTransition key={category.id} scope="cat" id={category.id}>
              <li className="bg-card overflow-hidden rounded-lg border py-1">
                <ManageRow
                  testId="category-row"
                  marker={
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-[10px]"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${categoryDisplayColor(category.color)} 18%, transparent)`,
                      }}
                    >
                      <CategoryMarker
                        icon={category.icon}
                        color={category.color}
                        className="size-4"
                      />
                    </span>
                  }
                  name={
                    <>
                      {category.name}
                      {budgeted.includes(category.id) && (
                        <span className="text-primary bg-primary/12 ml-2 rounded-full px-2 text-[11px] font-bold">
                          {t("budgetBadge")}
                        </span>
                      )}
                    </>
                  }
                  value={spent(category.id)}
                  onOpen={() => sheet.openEdit(category.id)}
                  openLabel={t("row.edit", { name: category.name })}
                  menuLabel={menuLabel(category.name)}
                  menu={menuFor(category, true)}
                />
                {children.length > 0 && (
                  <ul
                    aria-label={t("subcategoriesLabel", {
                      name: category.name,
                    })}
                  >
                    {children.map((child) => (
                      <ListRowTransition
                        key={child.id}
                        scope="cat"
                        id={child.id}
                      >
                        <li>
                          <ManageRow
                            testId="category-row"
                            nested
                            marker={
                              child.icon ? (
                                <CategoryMarker icon={child.icon} color={child.color} className="text-base" />
                              ) : (
                                <span
                                  aria-hidden="true"
                                  className="size-2.5 shrink-0 rounded-[3px]"
                                  style={{ backgroundColor: categoryDisplayColor(child.color) }}
                                />
                              )
                            }
                            name={child.name}
                            value={spent(child.id)}
                            onOpen={() => sheet.openEdit(child.id)}
                            openLabel={t("row.edit", { name: child.name })}
                            menuLabel={menuLabel(child.name)}
                            menu={menuFor(child, false)}
                          />
                        </li>
                      </ListRowTransition>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => setAddSubTo(category)}
                  aria-label={t("row.addSubcategory", { name: category.name })}
                  className="text-primary hover:bg-accent/60 focus-visible:ring-ring/50 flex min-h-11 w-full items-center gap-2 pr-3 pl-12 text-left text-sm font-semibold outline-none focus-visible:ring-[3px]"
                >
                  <Plus className="size-4" aria-hidden="true" />
                  {t("addSubcategoryShort")}
                </button>
              </li>
            </ListRowTransition>
          ))}
        </ul>
      )}

      <Sheet
        open={sheet.adding}
        onOpenChange={(open) => !open && sheet.close()}
      >
        {sheet.adding && (
          <SheetContent className="theme-50f" title={t("sheet.addTitle")}>
            <CategoryForm
              mode="create"
              parentOptions={parentOptions}
              usedColors={usedColors}
              defaultColor={defaultColor}
              onSaved={() => saved(t("toast.added"))}
            />
          </SheetContent>
        )}
      </Sheet>

      <Sheet
        open={addSubTo !== null}
        onOpenChange={(open) => !open && setAddSubTo(null)}
      >
        {addSubTo && (
          <SheetContent
            className="theme-50f"
            title={t("sheet.addSubcategoryTitle", { name: addSubTo.name })}
          >
            <CategoryForm
              mode="create"
              parentOptions={parentOptions}
              usedColors={usedColors}
              defaultParentId={addSubTo.id}
              defaultColor={subcategoryShade(
                addSubTo.color,
                tree.find((n) => n.category.id === addSubTo.id)?.children
                  .length ?? 0,
              )}
              onSaved={() => saved(t("toast.added"))}
            />
          </SheetContent>
        )}
      </Sheet>

      <Sheet
        open={editing !== null}
        onOpenChange={(open) => !open && sheet.close()}
      >
        {editing && (
          <SheetContent
            className="theme-50f"
            title={t("sheet.editTitle", { name: editing.name })}
          >
            <CategoryForm
              key={editing.id}
              mode="edit"
              category={editing}
              parentOptions={parentOptions}
              usedColors={usedColors}
              hasSubcategories={editingChildren > 0}
              onSaved={() => saved(t("toast.saved"))}
              onCancel={sheet.close}
            />
          </SheetContent>
        )}
      </Sheet>

      <DeleteCategorySheet
        target={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(name) => {
          setDeleting(null);
          toast.show({ message: t("toast.deleted", { name }) });
        }}
      />
    </>
  );
}
