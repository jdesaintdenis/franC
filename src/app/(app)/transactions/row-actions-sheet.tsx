"use client";

import { ArrowLeftRight, ListChecks, Shapes, Split, StickyNote, Tag, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { TransactionListItem } from "@/db/queries/transactions";

export type RowAction = "category" | "split" | "note" | "rename" | "transfer" | "select";

const ITEM =
  "hover:bg-muted focus-visible:ring-ring/50 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-medium outline-none focus-visible:ring-[3px]";

interface Props {
  /** The transaction the actions are for; null keeps the sheet closed. */
  item: TransactionListItem | null;
  /** The name shown on the row, for the sheet's description. */
  itemName: string;
  onClose: () => void;
  onAction: (action: RowAction, item: TransactionListItem) => void;
}

/** The swipe-left / ⋯ sheet: the things a row can do besides opening it. */
export function RowActionsSheet({ item, itemName, onClose, onAction }: Props) {
  const t = useTranslations("transactions.actions");
  const actions: { action: RowAction; label: string; Icon: LucideIcon }[] = [];
  if (item) {
    actions.push({ action: "category", label: t("changeCategory"), Icon: Shapes });
    // A transfer cannot be split and a zero amount has nothing to share: the dialog explains it otherwise.
    if (!item.transfer && item.amountCents !== 0) actions.push({ action: "split", label: t("split"), Icon: Split });
    actions.push({ action: "note", label: t("noteTags"), Icon: StickyNote });
    actions.push({ action: "rename", label: t("rename"), Icon: Tag });
    if (item.transfer) actions.push({ action: "transfer", label: t("transfer"), Icon: ArrowLeftRight });
    actions.push({ action: "select", label: t("select"), Icon: ListChecks });
  }
  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent title={t("title")} description={itemName} className="theme-50f">
        <ul className="-mx-2 flex flex-col">
          {item &&
            actions.map(({ action, label, Icon }) => (
              <li key={action}>
                <button type="button" data-testid={`row-action-${action}`} className={ITEM} onClick={() => onAction(action, item)}>
                  <Icon className="text-muted-foreground size-5" aria-hidden="true" />
                  {label}
                </button>
              </li>
            ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
