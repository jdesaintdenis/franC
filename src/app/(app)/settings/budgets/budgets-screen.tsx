"use client";

import { ArrowRight, Pencil, Trash2, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { ListRowTransition } from "@/components/list-row-transition";
import { CategoryMarker } from "@/components/category-marker";
import { EmptyState } from "@/components/empty-state";
import { EmptyAddLink } from "@/components/manage/empty-add-link";
import { rememberReturnFocus } from "@/components/manage/return-focus";
import { RowMenu } from "@/components/manage/row-menu";
import { useSheetParam } from "@/components/manage/use-sheet-param";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { ChargesPreset } from "@/lib/budgets/charges";
import type { BudgetPresets } from "@/lib/budgets/presets";
import type { BudgetEntry, BudgetItem } from "@/lib/budgets/progress";
import type { Suggestion, SuggestionCategory, SuggestionGroup } from "@/lib/budgets/suggestions";
import { CATEGORY_PATH_SEPARATOR } from "@/lib/categorize/hierarchy";
import { categoryDrillDownHref } from "@/lib/dashboard/month";
import { formatCents, formatWholeCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { BudgetGaugeRowContent, GAUGE_ROW_CLASS } from "../../home/budget-gauge-row";
import { removeBudgetAction, restoreBudgetAction } from "./actions";
import { AddBudgetSheet } from "./add-budget-sheet";
import { EditBudgetSheet } from "./edit-budget-sheet";

interface Props {
  /** Budgeted categories as Home draws them: parents with nested subcategories, sorted. */
  items: BudgetItem[];
  /** Rollover flag by category id (the entries carry the amounts, not the flag). */
  rollovers: Record<string, boolean>;
  categories: SuggestionCategory[];
  presets: Record<string, BudgetPresets>;
  /** This month's regular payments per category, for the sheet's "Payments" pill. */
  chargePresets: Record<string, ChargesPreset>;
  /** Unbudgeted categories for the add sheet. */
  groups: SuggestionGroup[];
  /** Top suggestions for the empty state. */
  top: Suggestion[];
  month: string;
  pace: { day: number; daysInMonth: number };
}

export function BudgetsScreen({ items, rollovers, categories, presets, chargePresets, groups, top, month, pace }: Props) {
  const t = useTranslations("settings.budgets");
  const tm = useTranslations("settings.manage");
  const toast = useToast();
  const sheet = useSheetParam();
  const [, startTransition] = useTransition();

  const byId = new Map(categories.map((c) => [c.id, c]));
  const parentNames: Record<string, string> = {};
  for (const c of categories) {
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    if (parent) parentNames[c.id] = parent.name;
  }
  const entries = new Map<string, BudgetEntry>();
  for (const item of items) {
    entries.set(item.categoryId, item);
    for (const child of item.children) entries.set(child.categoryId, child);
  }

  function remove(categoryId: string) {
    sheet.close();
    startTransition(async () => {
      try {
        const result = await removeBudgetAction(categoryId);
        if (result.status === "error") {
          toast.show({ message: result.error, variant: "error" });
          return;
        }
        const { snapshot } = result;
        if (!snapshot) return;
        toast.show({
          message: t("toast.removed"),
          undo: {
            onUndo: async () => {
              try {
                const restored = await restoreBudgetAction(snapshot);
                toast.show(
                  restored.status === "ok"
                    ? { message: t("toast.restored") }
                    : { message: restored.error, variant: "error" },
                );
              } catch {
                toast.show({ message: tm("undoFailed"), variant: "error" });
              }
            },
          },
        });
      } catch {
        toast.show({ message: t("errors.removeFailed"), variant: "error" });
      }
    });
  }

  function saved({ carryReset }: { carryReset: boolean }) {
    sheet.close();
    toast.show({ message: t(carryReset ? "toast.carryReset" : "toast.saved") });
  }

  const editing = sheet.editing ? byId.get(sheet.editing) : undefined;
  const editEntry = editing ? entries.get(editing.id) : undefined;
  const editForm = editing
    ? {
        category: { ...editing, parentName: parentNames[editing.id] ?? null },
        existing: editEntry ? { amountCents: editEntry.budgetCents, rollover: rollovers[editing.id] === true } : null,
        carryCents: editEntry?.carryCents ?? null,
        presets: presets[editing.id],
        charges: chargePresets[editing.id],
        suggestedCents:
          sheet.amountCents ?? ((presets[editing.id]?.averageCents ?? 0) > 0 ? (presets[editing.id]?.averageCents ?? null) : null),
        onSaved: saved,
        onRemove: editEntry ? () => remove(editing.id) : undefined,
      }
    : null;

  const rowFor = (entry: BudgetEntry, nested: boolean) => (
    <BudgetRow
      key={entry.categoryId}
      entry={entry}
      nested={nested}
      rollover={rollovers[entry.categoryId] === true}
      month={month}
      pace={pace}
      onEdit={() => sheet.openEdit(entry.categoryId)}
      onRemove={() => remove(entry.categoryId)}
    />
  );

  return (
    <>
      {items.length === 0 ? (
        <BudgetsEmpty top={top} onPick={(id) => sheet.openEdit(id)} />
      ) : (
        <ul aria-label={t("listLabel")} className="divide-border -my-1 divide-y">
          {items.map((item) => (
            <ListRowTransition key={item.categoryId} scope="bud" id={item.categoryId}>
            <li>
              {rowFor(item, false)}
              {item.subcategoriesExceedParent && <ExceedWarning item={item} />}
              {item.children.length > 0 && (
                <ul aria-label={t("subcategoriesLabel", { name: item.name })} className="divide-border divide-y border-t">
                  {item.children.map((child) => (
                    <ListRowTransition key={child.categoryId} scope="bud" id={child.categoryId}>
                    <li className="pl-5">
                      {rowFor(child, true)}
                    </li>
                    </ListRowTransition>
                  ))}
                </ul>
              )}
            </li>
            </ListRowTransition>
          ))}
        </ul>
      )}
      <AddBudgetSheet
        open={sheet.adding}
        groups={groups}
        presets={presets}
        chargePresets={chargePresets}
        parentNames={parentNames}
        onSaved={saved}
        onClose={sheet.close}
      />
      <EditBudgetSheet form={editForm} onClose={sheet.close} />
    </>
  );
}

function ExceedWarning({ item }: { item: BudgetItem }) {
  const t = useTranslations("settings.budgets");
  const locale = useLocale();
  return (
    <p role="note" className="text-warning pb-3 text-sm">
      <span aria-hidden="true">⚠ </span>
      {t("subcategoriesExceed", {
        sum: formatCents(item.childrenBudgetCents, locale),
        category: item.name,
        budget: formatCents(item.budgetCents, locale),
      })}
    </p>
  );
}

function BudgetRow({
  entry,
  nested,
  rollover,
  month,
  pace,
  onEdit,
  onRemove,
}: {
  entry: BudgetEntry;
  nested: boolean;
  rollover: boolean;
  month: string;
  pace: { day: number; daysInMonth: number };
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("settings.budgets");
  const tm = useTranslations("settings.manage");
  // A subcategory budget whose parent has none stands alone, so its name carries the parent.
  const name = entry.parentName && !nested ? `${entry.parentName}${CATEGORY_PATH_SEPARATOR}${entry.name}` : entry.name;
  const rollsOver = rollover && (entry.carryCents ?? 0) === 0;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={t("row.edit", { name })}
        onClick={(event) => {
          rememberReturnFocus(event.currentTarget);
          onEdit();
        }}
        className={cn(
          GAUGE_ROW_CLASS,
          "focus-visible:ring-ring/50 min-w-0 flex-1 cursor-pointer rounded-md py-3 text-left outline-none focus-visible:ring-[3px]",
        )}
      >
        <BudgetGaugeRowContent
          entry={entry}
          name={name}
          pace={pace}
          suffix={rollsOver ? ` · ${t("row.rollsOver")}` : undefined}
        />
      </button>
      <RowMenu
        label={tm("options", { name })}
        items={[
          { label: tm("edit"), icon: <Pencil aria-hidden="true" />, onSelect: onEdit },
          { label: tm("seeTransactions"), icon: <ArrowRight aria-hidden="true" />, href: categoryDrillDownHref(month, entry.categoryId, null) },
          { label: t("row.remove"), icon: <Trash2 aria-hidden="true" />, onSelect: onRemove, destructive: true },
        ]}
      />
    </div>
  );
}

function BudgetsEmpty({ top, onPick }: { top: Suggestion[]; onPick: (categoryId: string) => void }) {
  const t = useTranslations("settings.budgets");
  const locale = useLocale();
  return (
    <EmptyState
      icon={Wallet}
      title={t("empty.title")}
      body={t("empty.text")}
      action={<EmptyAddLink label={t("addLabel")} />}
    >
      {top.length > 0 && (
        <div className="mt-2 flex w-full flex-col gap-2 text-left">
          <h3 className="text-muted-foreground text-sm font-medium">{t("empty.suggestions")}</h3>
          <ul className="divide-y rounded-xl border">
            {top.map(({ category, averageCents }) => (
              <li key={category.id} className="flex items-center gap-3 py-1 pr-2 pl-4">
                <CategoryMarker icon={category.icon} color={category.color} />
                <span className="flex min-w-0 flex-1 flex-col py-2">
                  <span className="wrap-anywhere font-semibold">{category.name}</span>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {t("empty.average", { amount: formatWholeCents(averageCents, locale) })}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 shrink-0"
                  aria-label={t("empty.addLabel", { name: category.name })}
                  onClick={() => onPick(category.id)}
                >
                  {t("empty.add")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </EmptyState>
  );
}
