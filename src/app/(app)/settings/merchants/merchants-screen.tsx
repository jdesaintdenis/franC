"use client";

import { Eye, Pencil, Store, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { ListRowTransition } from "@/components/list-row-transition";
import { EmptyState } from "@/components/empty-state";
import { EmptyAddLink } from "@/components/manage/empty-add-link";
import { ManageRow } from "@/components/manage/manage-row";
import { useSheetParam } from "@/components/manage/use-sheet-param";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ToastViewport, useToast } from "@/components/toast";
import { networkErrorMessage } from "@/lib/offline";

import { deleteMerchantAction, restoreMerchantAction } from "./actions";
import { MerchantForm } from "./merchant-form";
import { MerchantSheet } from "./merchant-sheet";
import type { MerchantView } from "./merchant-view";

export function MerchantsScreen({ merchants }: { merchants: MerchantView[] }) {
  const t = useTranslations("settings.merchants");
  const tManage = useTranslations("settings.manage");
  const tErrors = useTranslations("settings.merchants.errors");
  const toast = useToast();
  const sheet = useSheetParam();
  const [, startTransition] = useTransition();
  const editing = merchants.find((m) => m.id === sheet.editing) ?? null;

  function remove(merchant: MerchantView) {
    startTransition(async () => {
      try {
        const result = await deleteMerchantAction(merchant.id);
        if (result.status === "error" || !result.snapshot) {
          toast.show({ message: result.status === "error" ? tErrors(result.error) : tManage("deleteFailed"), variant: "error" });
          return;
        }
        const snapshot = result.snapshot;
        toast.show({
          message: t("toast.deleted", { name: merchant.name }),
          undo: {
            onUndo: async () => {
              try {
                const restored = await restoreMerchantAction(snapshot);
                if (restored.status === "error") toast.show({ message: tErrors(restored.error), variant: "error" });
              } catch {
                toast.show({ message: tManage("undoFailed"), variant: "error" });
              }
            },
          },
        });
      } catch {
        toast.show({ message: networkErrorMessage(tManage("deleteFailed"), tErrors("offline")), variant: "error" });
      }
    });
  }

  return (
    <>
      {merchants.length === 0 ? (
        <EmptyState icon={Store} title={t("empty.title")} body={t("empty.body")} action={<EmptyAddLink label={t("empty.action")} />} />
      ) : (
        <ul aria-label={t("listLabel")} className="divide-y rounded-lg border">
          {merchants.map((merchant) => (
            <ListRowTransition key={merchant.id} scope="mer" id={merchant.id}>
<li>
              <ManageRow
                name={merchant.name}
                caption={t("caption", { transactions: merchant.transactionCount, patterns: merchant.patterns.length })}
                onOpen={() => sheet.openEdit(merchant.id)}
                menuLabel={tManage("options", { name: merchant.name })}
                menu={[
                  { label: tManage("edit"), icon: <Pencil className="size-4" />, onSelect: () => sheet.openEdit(merchant.id) },
                  {
                    label: tManage("seeTransactions"),
                    icon: <Eye className="size-4" />,
                    href: `/transactions?q=${encodeURIComponent(merchant.name)}`,
                  },
                  { label: tManage("delete"), icon: <Trash2 className="size-4" />, destructive: true, onSelect: () => remove(merchant) },
                ]}
              />
            </li>
</ListRowTransition>
          ))}
        </ul>
      )}

      <Sheet open={sheet.adding} onOpenChange={(open) => !open && sheet.close()}>
        <SheetContent className="theme-50f" title={t("addHeading")}>
          <MerchantForm
            onDone={(count) => {
              sheet.close();
              toast.show({ message: t("form.added", { count }) });
            }}
          />
          <ToastViewport inSheet />
        </SheetContent>
      </Sheet>

      <Sheet open={editing !== null} onOpenChange={(open) => !open && sheet.close()}>
        {editing && (
          <SheetContent className="theme-50f" title={editing.name}>
            <MerchantSheet merchant={editing} onSaved={sheet.close} />
            <ToastViewport inSheet />
          </SheetContent>
        )}
      </Sheet>
    </>
  );
}
