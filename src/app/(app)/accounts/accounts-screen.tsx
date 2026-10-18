"use client";

import { Coins, Eye, Landmark, Pencil, PiggyBank, Star, StarOff, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { HomeSection } from "@/app/(app)/home/home-section";
import { ManageRow } from "@/components/manage/manage-row";
import { useSheetParam } from "@/components/manage/use-sheet-param";
import { ToastViewport, useToast } from "@/components/toast";
import { Sheet, SheetContent } from "@/components/ui/sheet";

import { setHomeAccountAction } from "./actions";
import { AccountForm } from "./account-form";
import { AccountSheet } from "./account-sheet";
import type { AccountView } from "./account-view";
import { DeleteAccountDialog } from "./delete-account-dialog";

/** The accounts list with its sheets: add (`?add=1`), the account sheet (`?edit=<id>`), and the delete confirmation. */
export function AccountsScreen({
  accounts,
  today,
  homeAccountId,
}: {
  accounts: AccountView[];
  today: string;
  homeAccountId: string | null;
}) {
  const t = useTranslations("settings.accounts");
  const tManage = useTranslations("settings.manage");
  const toast = useToast();
  const sheet = useSheetParam();
  const [deleting, setDeleting] = useState<AccountView | null>(null);
  // "Starting balance" opens the same sheet with the amount field focused.
  const [focusBalance, setFocusBalance] = useState(false);
  const editing = accounts.find((a) => a.id === sheet.editing) ?? null;
  // A current account can't be deleted when it is the only one (imports need somewhere to go); Savings always can.
  const currentCount = accounts.filter((a) => !a.savings).length;
  const isLastOf = (account: AccountView) => !account.savings && currentCount === 1;
  const isLast = accounts.length === 1;
  const [defaultId, setDefaultId] = useState(homeAccountId);
  const [, startDefault] = useTransition();

  // Optimistic: the caption and menu flip at once; a failure flips them back with an error toast.
  const setDefault = (account: AccountView, makeDefault: boolean) => {
    const previous = defaultId;
    setDefaultId(makeDefault ? account.id : null);
    startDefault(async () => {
      const result = await setHomeAccountAction(makeDefault ? account.id : null);
      if (result.status === "error") {
        setDefaultId(previous);
        toast.show({ message: result.error, variant: "error" });
        return;
      }
      toast.show({
        message: makeDefault ? t("toast.defaultSet", { name: account.name }) : t("toast.defaultCleared"),
      });
    });
  };

  const open = (id: string, balance: boolean) => {
    setFocusBalance(balance);
    sheet.openEdit(id);
  };

  return (
    <>
      <HomeSection headingId="accounts-heading" title={t("sections.accounts")} testId="accounts-list" flush>
        <ul aria-label={t("listLabel")} className="divide-border divide-y">
          {accounts.map((account) => (
            <li key={account.id}>
              <ManageRow
                name={account.name}
                marker={
                  <span
                    aria-hidden="true"
                    className="bg-muted text-primary ml-2 flex size-8 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-[18px]"
                  >
                    {account.savings ? <PiggyBank /> : <Landmark />}
                  </span>
                }
                caption={
                  <>
                    <span className={account.stale ? "text-warning" : undefined}>
                      {account.savings
                        ? t("row.savingsLine", { count: account.moveCount })
                        : account.linkedBank
                          ? account.bankBalance
                            ? t("row.bank", {
                                bank: account.linkedBank,
                                when: account.bankBalance.readAt,
                              })
                            : t("row.bankNever", { bank: account.linkedBank })
                          : account.lastImport === null
                            ? t("row.csvNever")
                            : t("row.csv", { date: account.lastImport })}
                    </span>
                    {account.savings && account.assignedLabel && (
                      <span> · {t("row.assigned", { amount: account.assignedLabel })}</span>
                    )}
                    {!isLast && account.id === defaultId && <span className="block">{t("row.default")}</span>}
                  </>
                }
                value={
                  account.balanceLabel ? (
                    <span className="text-[19px] font-bold">{account.balanceLabel}</span>
                  ) : (
                    <span className="text-primary text-sm">{t("addBalance")}</span>
                  )
                }
                onOpen={() => open(account.id, false)}
                menuLabel={tManage("options", { name: account.name })}
                menu={[
                  // Only with several accounts: with one, Home is that account anyway.
                  ...(isLast
                    ? []
                    : [
                        account.id === defaultId
                          ? {
                              label: t("menu.removeDefault"),
                              icon: <StarOff className="size-4" />,
                              onSelect: () => setDefault(account, false),
                            }
                          : {
                              label: t("menu.setDefault"),
                              icon: <Star className="size-4" />,
                              onSelect: () => setDefault(account, true),
                            },
                      ]),
                  {
                    label: tManage("edit"),
                    icon: <Pencil className="size-4" />,
                    onSelect: () => open(account.id, false),
                  },
                  // A balance the bank supplies has no amount to edit; "Edit" opens the sheet with its read-only line.
                  ...(account.bankBalance
                    ? []
                    : [
                        {
                          label: t("menu.startingBalance"),
                          icon: <Coins className="size-4" />,
                          onSelect: () => open(account.id, true),
                        },
                      ]),
                  {
                    label: tManage("seeTransactions"),
                    icon: <Eye className="size-4" />,
                    href: `/transactions?account=${account.id}`,
                  },
                  {
                    label: isLastOf(account) ? t("menu.deleteLast") : tManage("delete"),
                    icon: <Trash2 className="size-4" />,
                    destructive: true,
                    disabled: isLastOf(account),
                    onSelect: () => setDeleting(account),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      </HomeSection>

      <Sheet open={sheet.adding} onOpenChange={(next) => !next && sheet.close()}>
        <SheetContent className="theme-50f" title={t("addHeading")}>
          <AccountForm
            mode="create"
            onSaved={() => {
              sheet.close();
              toast.show({ message: t("toast.added") });
            }}
          />
          <ToastViewport inSheet />
        </SheetContent>
      </Sheet>

      <Sheet open={editing !== null} onOpenChange={(next) => !next && sheet.close()}>
        {editing && (
          <SheetContent
            className="theme-50f"
            title={editing.name}
            onOpenAutoFocus={(event) => {
              if (!focusBalance) return;
              event.preventDefault();
              document.getElementById(`balance-amount-${editing.id}`)?.focus();
            }}
          >
            <AccountSheet
              key={editing.id}
              account={editing}
              isLast={isLastOf(editing)}
              showReminder={accounts.length > 1 && !editing.savings}
              today={today}
              onSaved={sheet.close}
            />
            <ToastViewport inSheet />
          </SheetContent>
        )}
      </Sheet>

      <DeleteAccountDialog
        account={deleting}
        goalNames={deleting?.goals.map((g) => g.name) ?? []}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
