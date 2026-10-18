"use client";

import { ArrowDown, ArrowUp, ListChecks, Pencil, Search, Trash2 } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { useTranslations } from "next-intl";

import { ListRowTransition } from "@/components/list-row-transition";
import { CategoryMarker } from "@/components/category-marker";
import { EmptyState } from "@/components/empty-state";
import { EmptyAddLink } from "@/components/manage/empty-add-link";
import { ManageRow } from "@/components/manage/manage-row";
import type { RowMenuItem } from "@/components/manage/row-menu";
import { useSheetParam } from "@/components/manage/use-sheet-param";
import { useToast } from "@/components/toast";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { networkErrorMessage } from "@/lib/offline";

import { deleteRuleAction, reorderRulesAction, restoreRuleAction } from "./actions";
import { RuleForm } from "./rule-form";
import { type CategoryOption, type RuleView } from "./rule-types";

type Change = { kind: "order"; ids: string[] } | { kind: "remove"; id: string };

/** Applies a pending change; unknown ids are dropped, so a stale order can't invent rules. */
function applyChange(rules: RuleView[], change: Change): RuleView[] {
  if (change.kind === "remove") return rules.filter((r) => r.id !== change.id);
  const byId = new Map(rules.map((r) => [r.id, r]));
  return change.ids.flatMap((id) => byId.get(id) ?? []);
}

export function RuleList({ rules: serverRules, categories }: { rules: RuleView[]; categories: CategoryOption[] }) {
  const t = useTranslations("settings");
  const toast = useToast();
  const sheet = useSheetParam();
  // Moves and deletes show immediately; if the action fails the server list comes back with an error toast.
  const [rules, applyOptimistic] = useOptimistic(serverRules, applyChange);
  const [, startTransition] = useTransition();
  const editing = sheet.editing ? (rules.find((r) => r.id === sheet.editing) ?? null) : null;

  function failed(message: string) {
    toast.show({ message, variant: "error" });
  }

  function move(index: number, delta: -1 | 1) {
    const ids = rules.map((r) => r.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    startTransition(async () => {
      applyOptimistic({ kind: "order", ids });
      try {
        const result = await reorderRulesAction(ids);
        if (result.status === "error") failed(result.error);
      } catch {
        failed(networkErrorMessage(t("rules.list.reorderError"), t("offline")));
      }
    });
  }

  async function undo(snapshot: Parameters<typeof restoreRuleAction>[0]) {
    try {
      const result = await restoreRuleAction(snapshot);
      if (result.status === "error") failed(result.error);
    } catch {
      failed(networkErrorMessage(t("manage.undoFailed"), t("offline")));
    }
  }

  function remove(rule: RuleView) {
    startTransition(async () => {
      applyOptimistic({ kind: "remove", id: rule.id });
      try {
        const result = await deleteRuleAction(rule.id);
        if (result.status === "error") {
          failed(result.error);
          return;
        }
        toast.show({ message: t("rules.toast.deleted"), undo: { onUndo: () => undo(result.snapshot) } });
      } catch {
        failed(networkErrorMessage(t("manage.deleteFailed"), t("offline")));
      }
    });
  }

  function menuFor(rule: RuleView, index: number): RowMenuItem[] {
    return [
      { label: t("manage.edit"), icon: <Pencil className="size-4" aria-hidden="true" />, onSelect: () => sheet.openEdit(rule.id) },
      {
        label: t("rules.menu.moveUp"),
        icon: <ArrowUp className="size-4" aria-hidden="true" />,
        disabled: index === 0,
        onSelect: () => move(index, -1),
      },
      {
        label: t("rules.menu.moveDown"),
        icon: <ArrowDown className="size-4" aria-hidden="true" />,
        disabled: index === rules.length - 1,
        onSelect: () => move(index, 1),
      },
      // A regex isn't a search term, so the transactions search can't show what it matches.
      ...(rule.matchType === "regex"
        ? []
        : [
            {
              label: t("rules.menu.seeMatching"),
              icon: <Search className="size-4" aria-hidden="true" />,
              href: `/transactions?q=${encodeURIComponent(rule.pattern)}`,
            },
          ]),
      {
        label: t("manage.delete"),
        icon: <Trash2 className="size-4" aria-hidden="true" />,
        destructive: true,
        onSelect: () => remove(rule),
      },
    ];
  }

  return (
    <>
      {rules.length === 0 ? (
        <EmptyState icon={ListChecks} title={t("rules.empty.title")} body={t("rules.empty.body")} action={<EmptyAddLink label={t("rules.empty.action")} />} />
      ) : (
        <ol aria-label={t("rules.list.label")} className="divide-y rounded-lg border py-1">
          {rules.map((rule, index) => (
            <ListRowTransition key={rule.id} scope="rule" id={rule.id}>
<li>
              <ManageRow
                testId="rule-row"
                marker={
                  <span
                    className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-sm tabular-nums"
                    aria-label={t("rules.list.priority", { position: index + 1 })}
                  >
                    {index + 1}
                  </span>
                }
                name={
                  <>
                    <span className="text-muted-foreground font-normal">{t(`rules.matchType.${rule.matchType}`)} </span>
                    <code className="bg-muted rounded px-1.5 py-0.5 text-sm font-normal break-all">{rule.pattern}</code>
                  </>
                }
                onOpen={() => sheet.openEdit(rule.id)}
                openLabel={t("rules.list.edit", { pattern: rule.pattern })}
                menuLabel={t("manage.options", { name: rule.pattern })}
                menu={menuFor(rule, index)}
              >
                <span className="mt-1 inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm">
                  <CategoryMarker icon={rule.categoryIcon} color={rule.categoryColor} />
                  <span className="wrap-anywhere">{rule.categoryLabel}</span>
                </span>
              </ManageRow>
            </li>
</ListRowTransition>
          ))}
        </ol>
      )}

      <Sheet open={sheet.adding} onOpenChange={(open) => !open && sheet.close()}>
        {sheet.adding && (
          <SheetContent className="theme-50f" title={t("rules.sheet.addTitle")}>
            <RuleForm
              mode="create"
              categories={categories}
              onSaved={(categorized) => {
                sheet.close();
                toast.show({ message: t("rules.toast.added", { count: categorized }) });
              }}
            />
          </SheetContent>
        )}
      </Sheet>

      <Sheet open={editing !== null} onOpenChange={(open) => !open && sheet.close()}>
        {editing && (
          <SheetContent className="theme-50f" title={t("rules.sheet.editTitle")}>
            <RuleForm
              key={editing.id}
              mode="edit"
              categories={categories}
              rule={editing}
              onSaved={(categorized) => {
                sheet.close();
                toast.show({ message: t("rules.toast.saved", { count: categorized }) });
              }}
              onCancel={sheet.close}
            />
          </SheetContent>
        )}
      </Sheet>
    </>
  );
}
