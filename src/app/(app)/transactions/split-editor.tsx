"use client";

import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import type { SplitPart } from "@/db/queries/splits";
import type { TransactionListItem } from "@/db/queries/transactions";
import type { CategoryOption } from "@/lib/categorize/hierarchy";
import { formatCents } from "@/lib/money";
import { centsToEuroInput, remainderState } from "@/lib/splits/editor";
import { euroInputToSignedCents, MAX_SPLIT_PARTS, splitRemainder, validateSplit } from "@/lib/splits/validate";

import {
  removeSplitAction,
  saveSplitAction,
  type RemoveSplitActionResult,
  type SaveSplitActionResult,
  type SplitActionErrorCode,
} from "./actions";

/** New split state for the edited row: `split` null means the split was removed. */
export interface SplitPatch {
  id: string;
  split: { parts: SplitPart[] } | null;
  /** Set on removal: the row's own category applies again. */
  category?: TransactionListItem["category"];
  categorySource?: TransactionListItem["categorySource"];
}

interface DraftPart {
  key: number;
  categoryId: string;
  amount: string;
}

interface Props {
  item: TransactionListItem;
  categories: CategoryOption[];
  onSaved: (patch: SplitPatch) => void;
  /** Leaves the editor without saving. */
  onCancel: () => void;
}

// Module-level so keys stay unique across editors; they only identify rows within one list.
let partKeySeq = 0;
const nextPartKey = () => partKeySeq++;

const selectClass = `${NATIVE_SELECT_CLASS} h-11`;

export function SplitEditor({ item, categories, onSaved, onCancel }: Props) {
  const locale = useLocale();
  const t = useTranslations("transactions.split");
  const tGlossary = useTranslations("common.glossary");
  const tActions = useTranslations("common.actions");
  const tErrors = useTranslations("transactions.errors");
  const isSplit = item.split !== null;

  // A new split starts as one part holding the row's current category and full amount.
  const [parts, setParts] = useState<DraftPart[]>(() =>
    item.split
      ? item.split.parts.map((p) => ({
          key: nextPartKey(),
          categoryId: p.category?.id ?? "",
          amount: centsToEuroInput(p.amountCents, locale),
        }))
      : [{ key: nextPartKey(), categoryId: item.category?.id ?? "", amount: centsToEuroInput(item.amountCents, locale) }],
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [isPending, startTransition] = useTransition();
  const idPrefix = useId();

  const parsed = parts.map((p) => ({
    categoryId: p.categoryId === "" ? null : p.categoryId,
    // Unreadable text counts as 0 in the remainder and blocks saving below.
    amountCents: euroInputToSignedCents(p.amount, item.amountCents),
  }));
  const remainder = splitRemainder(
    item.amountCents,
    parsed.map((p) => ({ amountCents: p.amountCents ?? 0 })),
  );
  const state = remainderState(item.amountCents, remainder);
  const inputsReadable = parsed.every((p) => p.amountCents !== null);
  const canSave =
    inputsReadable &&
    validateSplit(
      item.amountCents,
      parsed.map((p) => ({ categoryId: p.categoryId, amountCents: p.amountCents ?? 0 })),
    ).ok;

  function update(key: number, patch: Partial<DraftPart>) {
    setParts((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function addPart() {
    // Pre-fill what is still unassigned so the last part rarely needs typing.
    const amount = state.kind === "left" ? centsToEuroInput(state.cents, locale) : "";
    setParts((prev) => [...prev, { key: nextPartKey(), categoryId: "", amount }]);
  }

  function errorText(code: SplitActionErrorCode): string {
    return t(`errors.${code}`);
  }

  function save() {
    if (!canSave) return;
    setError(null);
    startTransition(async () => {
      let result: SaveSplitActionResult;
      try {
        result = await saveSplitAction({
          transactionId: item.id,
          parts: parsed.map((p) => ({ categoryId: p.categoryId, amountCents: p.amountCents })),
        });
      } catch {
        setError(navigator.onLine === false ? tErrors("offline") : tErrors("saveFailed"));
        return;
      }
      if (result.status === "error") {
        setError(errorText(result.error));
        return;
      }
      onSaved({ id: item.id, split: { parts: result.parts } });
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      let result: RemoveSplitActionResult;
      try {
        result = await removeSplitAction({ transactionId: item.id });
      } catch {
        setError(navigator.onLine === false ? tErrors("offline") : tErrors("saveFailed"));
        return;
      }
      if (result.status === "error") {
        setError(errorText(result.error));
        return;
      }
      onSaved({ id: item.id, split: null, category: result.category, categorySource: result.categorySource });
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <p className="text-muted-foreground text-sm">{t("intro")}</p>

      <ul aria-label={t("partsLabel")} className="flex flex-col gap-3">
        {parts.map((part, index) => {
          const n = index + 1;
          const categoryId = `${idPrefix}-cat-${part.key}`;
          const amountId = `${idPrefix}-amount-${part.key}`;
          const unreadable = part.amount.trim() !== "" && euroInputToSignedCents(part.amount, item.amountCents) === null;
          return (
            <li key={part.key} data-testid="split-part" className="flex flex-col gap-1.5 rounded-md border p-3">
              <p className="text-sm font-medium">{t("part", { n })}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor={categoryId} className="text-muted-foreground text-xs">
                    {tGlossary("category")}
                    <span className="sr-only"> {t("partSuffix", { n })}</span>
                  </Label>
                  <select
                    id={categoryId}
                    value={part.categoryId}
                    onChange={(e) => update(part.key, { categoryId: e.target.value })}
                    disabled={isPending}
                    className={selectClass}
                  >
                    <option value="">{t("chooseCategory")}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex flex-1 flex-col gap-1 sm:w-32 sm:flex-none">
                    <Label htmlFor={amountId} className="text-muted-foreground text-xs">
                      {t("amount")}
                      <span className="sr-only"> {t("partSuffix", { n })}</span>
                    </Label>
                    <div className="relative">
                      <Input
                        id={amountId}
                        inputMode="decimal"
                        autoComplete="off"
                        value={part.amount}
                        onChange={(e) => update(part.key, { amount: e.target.value })}
                        disabled={isPending}
                        aria-invalid={unreadable || undefined}
                        className="h-11 w-full pr-8 text-base tabular-nums md:text-sm"
                      />
                      <span aria-hidden="true" className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm">
                        €
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0"
                    disabled={isPending || parts.length <= 1}
                    onClick={() => setParts((prev) => prev.filter((p) => p.key !== part.key))}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    <span className="sr-only">{t("removePart", { n })}</span>
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <Button
        type="button"
        variant="outline"
        className="h-11"
        disabled={isPending || parts.length >= MAX_SPLIT_PARTS}
        onClick={addPart}
      >
        <Plus aria-hidden="true" className="size-4" />
        {t("addPart")}
      </Button>

      <p
        aria-live="polite"
        data-testid="split-remainder"
        className={
          state.kind === "over"
            ? "text-destructive text-sm font-medium"
            : state.kind === "balanced"
              ? "text-sm font-medium text-positive"
              : "text-sm font-medium"
        }
      >
        {state.kind === "balanced"
          ? t("balanced")
          : state.kind === "left"
            ? t("leftToAssign", { amount: formatCents(state.cents, locale) })
            : t("over", { amount: formatCents(state.cents, locale) })}
      </p>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {isSplit &&
        (confirmingRemove ? (
          <div className="flex flex-col gap-2 rounded-md border p-3" role="group" aria-label={t("removeConfirmLabel")}>
            <p className="text-sm">{t("removeConfirm")}</p>
            <div className="flex gap-2">
              <Button type="button" variant="destructive" className="h-11 flex-1" disabled={isPending} onClick={remove}>
                {t("removeConfirmYes")}
              </Button>
              <Button type="button" variant="outline" className="h-11 flex-1" disabled={isPending} onClick={() => setConfirmingRemove(false)}>
                {t("removeConfirmNo")}
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="outline" className="h-11" disabled={isPending} onClick={() => setConfirmingRemove(true)}>
            {t("remove")}
          </Button>
        ))}

      <DialogFooter className="flex-row gap-2">
        <Button type="button" variant="outline" className="h-11 flex-1" disabled={isPending} onClick={onCancel}>
          {tActions("cancel")}
        </Button>
        <Button type="submit" className="h-11 flex-1" disabled={isPending || !canSave}>
          {isPending ? t("saving") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
