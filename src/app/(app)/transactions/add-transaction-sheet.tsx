"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { useToast } from "@/components/toast";
import { useToday } from "@/components/today-provider";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

import { CategoryPickerList } from "./category-picker-list";
import {
  createManualTransactionAction,
  deleteManualTransactionAction,
  type ManualErrorCode,
} from "./manual-actions";
import { ManualForm, type ManualFormValues } from "./manual-form";
import { StepFrame } from "./sheet-steps";
import type { CategoryOption } from "./sheet-types";

/** The ＋ in the page header: adds a transaction by hand to a Current account. */
export function AddTransactionSheet({
  accounts,
  defaultAccountId,
  categories,
}: {
  /** Current accounts only. */
  accounts: { id: string; name: string }[];
  defaultAccountId: string;
  categories: CategoryOption[];
}) {
  const t = useTranslations("transactions.add");
  const [open, setOpen] = useState(false);
  if (accounts.length === 0) return null;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={t("open")}
          data-testid="add-transaction"
          className="hover:bg-muted focus-visible:ring-ring/50 flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]"
        >
          <Plus className="size-6" aria-hidden="true" />
        </button>
      </SheetTrigger>
      {/* The body is mounted per opening, so each one starts from an empty form. */}
      <SheetContent title={t("title")} className="theme-50f">
        <AddBody accounts={accounts} defaultAccountId={defaultAccountId} categories={categories} close={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function AddBody({
  accounts,
  defaultAccountId,
  categories,
  close,
}: {
  accounts: { id: string; name: string }[];
  defaultAccountId: string;
  categories: CategoryOption[];
  close: () => void;
}) {
  const t = useTranslations("transactions.add");
  const tErrors = useTranslations("transactions.errors");
  const tPicker = useTranslations("transactions.picker");
  const toast = useToast();
  const today = useToday();
  const [step, setStep] = useState<"form" | "category">("form");
  const [creating, setCreating] = useState(false);
  // The form's values are kept here so the category step can come back to them.
  const [values, setValues] = useState<ManualFormValues>({
    direction: "expense",
    amount: "",
    label: "",
    date: today,
    accountId: defaultAccountId,
  });
  // Categories created in the picker while this sheet is open.
  const [created, setCreated] = useState<CategoryOption[]>([]);
  const options = [...categories, ...created];
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<ManualErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const category = options.find((c) => c.id === categoryId) ?? null;

  function submit(next: ManualFormValues) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createManualTransactionAction({
          accountId: next.accountId,
          direction: next.direction,
          amount: next.amount,
          label: next.label,
          date: next.date,
          categoryId,
        });
        if (result.status === "error") {
          setError(result.error);
          return;
        }
        close();
        toast.show({
          message: result.awaitingBank ? t("addedWaiting") : t("added"),
          undo: {
            onUndo: async () => {
              try {
                const undone = await deleteManualTransactionAction({ id: result.id });
                if (undone.status === "error") toast.show({ message: tErrors("undoFailed"), variant: "error" });
              } catch {
                toast.show({ message: tErrors("undoFailed"), variant: "error" });
              }
            },
          },
        });
      } catch {
        setError("invalidInput");
      }
    });
  }

  if (step === "category") {
    return (
      <StepFrame
        title={creating ? tPicker("newCategory") : t("category")}
        onBack={creating ? () => setCreating(false) : () => setStep("form")}
      >
        <CategoryPickerList
          categories={options}
          currentId={categoryId}
          creating={creating}
          onCreatingChange={setCreating}
          onPick={(id, createdOption) => {
            if (createdOption) setCreated((prev) => [...prev, createdOption]);
            setCategoryId(id);
            setCreating(false);
            setStep("form");
          }}
        />
      </StepFrame>
    );
  }

  return (
    <ManualForm
      values={values}
      onChange={setValues}
      accounts={accounts}
      categoryLabel={category?.label ?? null}
      onChooseCategory={() => setStep("category")}
      today={today}
      submitLabel={t("submit")}
      pending={pending}
      error={error}
      onSubmit={submit}
    />
  );
}
