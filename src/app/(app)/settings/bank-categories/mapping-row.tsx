"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/toast";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { networkErrorMessage } from "@/lib/offline";

import { updateBankMappingAction } from "./actions";
import { ForgetMappingButton } from "./forget-mapping-button";

const IGNORE = "ignore";

export interface MappingRowData {
  id: string;
  /** Bank names shown as-is: "Category" or "Category > Subcategory". */
  name: string;
  /** The subcategory when this is a subcategory row (shown on its own). */
  displayName: string;
  categoryId: string | null;
}

export function MappingRow({
  mapping,
  categories,
  indented,
}: {
  mapping: MappingRowData;
  categories: { id: string; label: string }[];
  indented: boolean;
}) {
  const t = useTranslations("settings.bankCategories");
  const tOffline = useTranslations("settings");
  const tToast = useTranslations("common.toast");
  const toast = useToast();
  const [value, setValue] = useState(mapping.categoryId ?? IGNORE);
  const [pending, startTransition] = useTransition();
  const selectId = `bank-mapping-${mapping.id}`;

  function change(next: string) {
    const previous = value;
    setValue(next);
    // A failure puts the choice back and says so in a toast, with Try again.
    const failed = (text: string) => {
      setValue(previous);
      toast.show({ message: text, variant: "error", action: { label: tToast("retry"), onAction: () => change(next) } });
    };
    startTransition(async () => {
      try {
        const result = await updateBankMappingAction({
          mappingId: mapping.id,
          categoryId: next === IGNORE ? null : next,
        });
        if (result.status === "error") failed(result.error);
        else toast.show({ message: result.rowsUpdated === 0 ? t("savedNone") : t("saved", { count: result.rowsUpdated }) });
      } catch {
        failed(networkErrorMessage(t("saveError"), tOffline("offline")));
      }
    });
  }

  return (
    <div className={`flex flex-col gap-2 p-3 ${indented ? "pl-6" : ""}`}>
      <Label htmlFor={selectId} className={`break-words ${indented ? "font-normal" : "font-medium"}`}>
        <span className="sr-only">{t("selectLabel", { name: mapping.name })}</span>
        <span aria-hidden="true">{mapping.displayName}</span>
      </Label>
      <div className="flex items-center gap-2">
        <select
          id={selectId}
          value={value}
          disabled={pending}
          onChange={(e) => change(e.target.value)}
          className={`${NATIVE_SELECT_CLASS} h-11 min-w-0 flex-1`}
        >
          <option value={IGNORE}>{t("ignore")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <ForgetMappingButton mappingId={mapping.id} name={mapping.name} />
      </div>
      {pending && (
        <p role="status" className="text-muted-foreground text-xs">
          {t("saving")}
        </p>
      )}
    </div>
  );
}
