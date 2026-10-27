"use client";

import { ArrowLeftRight, CalendarClock, ChevronRight, Eye, EyeOff, Pencil, PiggyBank, Repeat, Sparkles, Split, Tag, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode, type Ref } from "react";
import { useRouter } from "next/navigation";

import { NoCategoriesHint } from "@/components/no-categories-hint";
import { CategoryMarker } from "@/components/category-marker";
import { categoryPath, type SuggestionCreated } from "@/components/rule-suggestion-line";
import { useToast, ToastViewport } from "@/components/toast";
import { useToday } from "@/components/today-provider";
import { TransactionAvatar } from "@/components/transaction-avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { TransactionListItem } from "@/db/queries/transactions";
import { addMonths, formatMonthName, inSentence } from "@/lib/dashboard/month";
import { formatDay, formatShortInstant } from "@/lib/format-date";
import { amountToInput, parseManualForm } from "@/lib/manual/input";
import { formatCents, formatSignedCents } from "@/lib/money";
import { categoryChangePatch, findCategoryRef } from "@/lib/optimistic/category";
import { revertPatches, snapshotFields } from "@/lib/optimistic/patch";
import { createSerialQueue, type SerialQueue } from "@/lib/optimistic/queue";
import { canValidate } from "@/lib/transactions/validation";
import { cn } from "@/lib/utils";

import { removePatternAction, deleteMerchantAction } from "../settings/merchants/actions";
import { acceptGuessAction } from "../review/actions";
import {
  categorizeTransaction,
  categorySuggestionsAction,
  ignoreTransactionAction,
  linkTransferAction,
  moveToSavingsAction,
  removeSavingsMoveAction,
  removeSplitAction,
  saveSplitAction,
  setPaidFromNextMonthAction,
  unignoreTransactionAction,
  unlinkTransferAction,
  validateTransactionAction,
} from "./actions";
import { useCategoryChangeToast, useMovedMessage, useMoveFailedToast } from "./category-change";
import {
  deleteManualTransactionAction,
  restoreManualTransactionAction,
  updateManualTransactionAction,
  type ManualErrorCode,
} from "./manual-actions";
import { ManualForm, type ManualFormValues } from "./manual-form";
import { CategoryPickerList } from "./category-picker-list";
import { NoteForm } from "./note-form";
import { RenameMerchantForm, type RenameSaved } from "./rename-merchant-form";
import { offerDraft, RuleProposalCard, type RuleOffer } from "./rule-proposal";
import { RuleForm, StepFrame } from "./sheet-steps";
import type { CategorizedResult, CategoryOption, CategoryRestore, NoteTagsPatch, SheetSection } from "./sheet-types";
import { SplitEditor, type SplitPatch } from "./split-editor";
import { TagsEditor } from "./tags-editor";
import { rowDisplayName } from "./transaction-row";
import { SavingsStep, type MovedToSavings, type SavingsAccountOption } from "./savings-step";
import { LoanLine } from "./loan-line";
import { TransferSection, type TransferChange, type TransferPatch } from "./transfer-section";
import { restoreSplitParts } from "./split-undo";
import { trackRecurringAction, untrackRecurringAction } from "../recurring/actions";
import { undoRuleAction } from "./undo-actions";

type Step = "category" | "split" | "transfer" | "rename" | "rule" | "savings" | "edit";

export interface TransactionSheetProps {
  /** The transaction being edited; null keeps the sheet closed. */
  item: TransactionListItem | null;
  categories: CategoryOption[];
  /** The user's merchant names, suggested in the rename form. */
  merchantNames: string[];
  /** The user's tag names, suggested in the tags editor. */
  tagNames: string[];
  /** True when the user has several accounts. */
  showAccount?: boolean;
  /** The user's Savings accounts, offered by Move to savings (Slice 52). */
  savingsAccounts?: SavingsAccountOption[];
  onClose: () => void;
  /** The screen's save queue, so a category change and its Undo reach the server in tap order. Defaults to the sheet's own. */
  queue?: SerialQueue;
  /** Called with the row as it was before the change. */
  onCategorized: (item: TransactionListItem, result: CategorizedResult) => void;
  /** Undo of a category change: the row gets its previous category, source and review state back. */
  onCategoryRestored: (restore: CategoryRestore) => void;
  /** A rule was created: the loaded rows it categorized show the new category. */
  onRuleCreated: (created: SuggestionCreated) => void;
  /** Undo of a rule: these rows are uncategorized again. */
  onRulesUndone: (transactionIds: string[]) => void;
  /** A transfer was linked, confirmed or unlinked; patches apply to loaded rows. */
  onTransferChanged: (patches: TransferPatch[]) => void;
  /** A split was saved or removed; the list patches the row in place. */
  onSplitChanged: (patch: SplitPatch) => void;
  /** A note or the tags were saved; the list patches the row in place. */
  onNoteTagsChanged: (patch: NoteTagsPatch) => void;
  /** The row was ignored or brought back (also by Undo); `item` is the row with its new state. */
  onIgnoredChanged: (item: TransactionListItem, ignored: boolean) => void;
  /** Opens on a step (or the note) instead of the main view. */
  initialSection?: SheetSection;
  /** A merchant was renamed (or the rename undone); other loaded rows may show a new name. */
  onMerchantRenamed?: () => void;
  /** The user keeps a regular income for next month: offers "Paid with next month's money" on this month's expenses (Slice 79). */
  keepsIncome?: boolean;
}

function initialStep(item: TransactionListItem, section: SheetSection | undefined, showAccount: boolean): Step | null {
  if (section === "split" && item.transfer === null && item.amountCents !== 0) return "split";
  if (section === "rename") return "rename";
  if (section === "transfer" && showAccount) return "transfer";
  return null;
}

/**
 * The transaction detail sheet: every change saves on its own (with an Undo toast), so there is
 * no Save or Cancel. Steps (category, split, transfer, rename, rule) replace the main view.
 */
export function TransactionSheet({ item, onClose, ...rest }: TransactionSheetProps) {
  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      {/* Keyed so each opened transaction starts from fresh state. */}
      {item && <SheetBody key={item.id} item={item} close={onClose} {...rest} />}
    </Sheet>
  );
}

function ActionRow({
  icon,
  label,
  detail,
  onClick,
  testId,
}: {
  icon: ReactNode;
  label: string;
  detail?: string | null;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="hover:bg-muted focus-visible:ring-ring/50 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base outline-none focus-visible:ring-[3px]"
    >
      <span aria-hidden="true" className="text-muted-foreground flex size-5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{label}</span>
        {detail && <span className="text-muted-foreground text-sm break-words">{detail}</span>}
      </span>
      <ChevronRight aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
    </button>
  );
}

function SheetBody({
  item: initial,
  categories,
  merchantNames,
  tagNames,
  showAccount = false,
  savingsAccounts = [],
  onCategorized,
  onCategoryRestored,
  onRuleCreated,
  onRulesUndone,
  onTransferChanged,
  onSplitChanged,
  onNoteTagsChanged,
  initialSection,
  onMerchantRenamed,
  onIgnoredChanged,
  keepsIncome = false,
  close,
  queue: screenQueue,
}: Omit<TransactionSheetProps, "item" | "onClose"> & { item: TransactionListItem; close: () => void }) {
  const locale = useLocale();
  const today = useToday();
  const toast = useToast();
  const tToast = useTranslations("common.toast");
  const t = useTranslations("transactions.sheet");
  const tCat = useTranslations("transactions.categorize");
  const tErrors = useTranslations("transactions.errors");
  const tGlossary = useTranslations("common.glossary");
  const tActions = useTranslations("transactions.actions");
  const tSplit = useTranslations("transactions.split");
  const tPicker = useTranslations("transactions.picker");
  const tToastList = useTranslations("transactions.toast");
  const tTransfer = useTranslations("transactions.transfer");
  const tAdd = useTranslations("transactions.add");
  const tMerchant = useTranslations("transactions.merchant");
  const showCategoryToast = useCategoryChangeToast();
  const showMoveFailed = useMoveFailedToast();
  const movedMessage = useMovedMessage();
  const [ownQueue] = useState(createSerialQueue);
  const queue = screenQueue ?? ownQueue;

  // The sheet keeps its own copy of the row so it reflects every change it makes, whatever the page does.
  const [item, setItem] = useState(initial);
  const patch = (changes: Partial<TransactionListItem>) => setItem((prev) => ({ ...prev, ...changes }));
  // The category step is creating a category: the step frame then shows "New category" and Back returns to the list.
  const [pickerCreating, setPickerCreating] = useState(false);
  const [step, setStep] = useState<Step | null>(() => initialStep(initial, initialSection, showAccount));
  // Radix keeps onEscapeKeyDown from the last passive effect, which can still see a step that just closed:
  // an Escape in that gap only "backed out" of it. A layout effect updates this before the screen does.
  const stepOpen = useRef(step !== null);
  useLayoutEffect(() => {
    stepOpen.current = step !== null;
  }, [step]);
  const [offer, setOffer] = useState<RuleOffer | null>(null);
  const [ruleDraft, setRuleDraft] = useState<ReturnType<typeof offerDraft> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // The row as shown now, for a save that finishes after the sheet moved on.
  const itemRef = useRef(item);
  useEffect(() => {
    itemRef.current = item;
  }, [item]);
  // Back returns focus to the row that opened the step.
  const opener = useRef<HTMLElement | null>(null);
  const returnFocus = useRef(false);
  const noteField = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (step === null && returnFocus.current) {
      returnFocus.current = false;
      opener.current?.focus();
    }
  }, [step]);

  function openStep(next: Step, e?: React.MouseEvent<HTMLElement>) {
    if (e) opener.current = e.currentTarget;
    setError(null);
    setPickerCreating(false);
    setStep(next);
  }

  function closeStep() {
    returnFocus.current = true;
    setPickerCreating(false);
    setStep(null);
  }

  /** A failed save is a toast, with Try again. */
  function toastFailure(message: string, retry: () => void) {
    toast.show({ message, variant: "error", action: { label: tToast("retry"), onAction: retry } });
  }

  function failed() {
    return navigator.onLine === false ? tErrors("offline") : tErrors("saveFailed");
  }

  // Rows added by hand (Slice 56): Edit and Delete. The form keeps its values while the step is open.
  const [manualValues, setManualValues] = useState<ManualFormValues>(() => ({
    direction: initial.amountCents < 0 ? "expense" : "income",
    amount: amountToInput(initial.amountCents),
    label: initial.shortLabel,
    date: initial.date,
    accountId: initial.accountId,
  }));
  const [manualError, setManualError] = useState<ManualErrorCode | null>(null);

  function saveManualEdit(values: ManualFormValues) {
    setManualError(null);
    const parsed = parseManualForm(values, { today });
    if (!parsed.ok) {
      setManualError(parsed.error);
      return;
    }
    startTransition(async () => {
      try {
        const result = await updateManualTransactionAction({
          id: itemRef.current.id,
          direction: values.direction,
          amount: values.amount,
          label: values.label,
          date: values.date,
        });
        if (result.status === "error") {
          setManualError(result.error);
          return;
        }
      } catch {
        setManualError("invalidInput");
        return;
      }
      const { amountCents, label, date } = parsed.value;
      patch({ amountCents, date, label, shortLabel: label, bankLabel: label });
      closeStep();
      toast.show({ message: tAdd("saved") });
    });
  }

  /** Deletes the row; the toast's Undo puts it back (with a new id, so the list reloads). */
  function deleteManual() {
    const before = itemRef.current;
    startTransition(async () => {
      let snapshot: Awaited<ReturnType<typeof deleteManualTransactionAction>>;
      try {
        snapshot = await deleteManualTransactionAction({ id: before.id });
      } catch {
        toastFailure(failed(), deleteManual);
        return;
      }
      if (snapshot.status === "error") {
        toastFailure(failed(), deleteManual);
        return;
      }
      const saved = snapshot.snapshot;
      toast.show({
        message: t("deleted"),
        undo: {
          onUndo: async () => {
            try {
              const restored = await restoreManualTransactionAction(saved);
              if (restored.status === "error") toast.show({ message: tErrors("undoFailed"), variant: "error" });
            } catch {
              toast.show({ message: navigator.onLine === false ? tErrors("offline") : tErrors("undoFailed"), variant: "error" });
            }
          },
        },
      });
      close();
    });
  }

  const name = rowDisplayName(item, locale);
  const guessed = item.categorySource === "guess" && item.category !== null && !item.split;
  const validatable = canValidate(item);

  /** Applies a category change that already happened on the server, with its Undo toast. */
  function categoryChanged(before: TransactionListItem, next: { category: TransactionListItem["category"]; categorySource: TransactionListItem["categorySource"] }, message: string) {
    patch({ category: next.category, categorySource: next.categorySource, reviewed: next.category !== null });
    showCategoryToast(
      before,
      message,
      (restore) => {
        patch({ category: restore.category, categorySource: restore.categorySource, reviewed: restore.reviewed });
        setOffer(null);
        onCategoryRestored(restore);
      },
      queue,
    );
  }

  /** The step closes, the row and the toast change now, and the save follows. A refusal puts the row back. */
  function pickCategory(categoryId: string | null, created?: CategoryOption) {
    const before = item;
    // A just-created category isn't in `categories` until the page refreshes.
    const category = findCategoryRef(created ? [created] : categories, categoryId);
    const applied = new Map([[before.id, categoryChangePatch(category)]]);
    const previous = snapshotFields([before], [before.id], ["category", "categorySource", "reviewed"] as const);
    onCategorized(before, { status: "done", category, categorySource: category ? "manual" : null, retro: {}, retroCategories: {} });
    categoryChanged(before, { category, categorySource: category ? "manual" : null }, movedMessage(category));
    setOffer(null);
    closeStep();

    const fail = () => {
      const shown = itemRef.current;
      // A newer change to the row wins over putting this one back.
      if (shown.category?.id === category?.id) {
        onCategoryRestored({ id: before.id, category: before.category, categorySource: before.categorySource, reviewed: before.reviewed });
      }
      setItem((prev) => revertPatches([prev], applied, previous)[0]);
      showMoveFailed(category?.name ?? tGlossary("uncategorized"), () => pickCategory(categoryId, created));
    };
    queue(() => categorizeTransaction({ transactionId: before.id, categoryId })).then((result) => {
      if (result.status === "error") return fail();
      if (result.ruleSuggestion) setOffer({ kind: "suggestion", suggestion: result.ruleSuggestion });
      else if (result.ruleProposal && result.category) setOffer({ kind: "proposal", proposal: result.ruleProposal, category: result.category });
    }, fail);
  }

  /** Suggested category ids for this row, loaded once per row; empty until they arrive. */
  const [suggestedIds, setSuggestedIds] = useState<string[]>([]);
  // History first; with little of it, the first top-level categories fill the row so there is always something to tap.
  const pillCategories = (() => {
    const picked = suggestedIds.map((id) => categories.find((c) => c.id === id)).filter((c): c is CategoryOption => c !== undefined);
    const rest = categories.filter((c) => c.parentId === null && !picked.some((p) => p.id === c.id));
    return [...picked, ...rest].filter((c) => c.id !== item.category?.id).slice(0, 4);
  })();
  useEffect(() => {
    let live = true;
    categorySuggestionsAction({ transactionId: item.id }).then(
      (ids) => live && setSuggestedIds(ids),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [item.id]);

  /** "Valider en X": the row leaves the review queue (an accepted guess becomes a hand choice) and the sheet closes. */
  function validateHere() {
    const before = itemRef.current;
    if (!before.category) return;
    const category = before.category;
    onCategorized(before, { status: "done", category, categorySource: "manual", retro: {}, retroCategories: {} });
    patch({ categorySource: "manual", reviewed: true });
    showCategoryToast(before, tToastList("validated"), (restore) => {
      patch({ category: restore.category, categorySource: restore.categorySource, reviewed: restore.reviewed });
      onCategoryRestored(restore);
    }, queue);
    queue(() => validateTransactionAction({ transactionId: before.id })).then(
      (result) => {
        if (result.status === "error") undoValidation(before);
      },
      () => undoValidation(before),
    );
    close();
  }

  function undoValidation(before: TransactionListItem) {
    onCategoryRestored({ id: before.id, category: before.category, categorySource: before.categorySource, reviewed: before.reviewed });
    toast.show({ message: navigator.onLine === false ? tErrors("offline") : tErrors("saveFailed"), variant: "error" });
  }

  /** Keeps the guessed category as a hand categorization (and reviewed), like the review page's Accept. */
  function keepGuess() {
    const before = item;
    if (!before.category) return;
    startTransition(async () => {
      try {
        const result = await acceptGuessAction({ transactionId: before.id });
        if (result.status === "error") {
          toastFailure(result.error === "notFound" ? tErrors("notFound") : tErrors("saveFailed"), keepGuess);
          return;
        }
        onCategorized(before, {
          status: "done",
          category: result.category,
          categorySource: "manual",
          retro: {},
          retroCategories: {},
          ruleSuggestion: result.ruleSuggestion,
        });
        categoryChanged(before, { category: result.category, categorySource: "manual" }, t("guessKept", { category: result.category?.name ?? "" }));
        setOffer(result.ruleSuggestion ? { kind: "suggestion", suggestion: result.ruleSuggestion } : null);
      } catch {
        toastFailure(failed(), keepGuess);
      }
    });
  }

  /** "Rule created · N others categorized" with Undo, for both Create rule and the Adjust step. */
  function ruleCreated(created: SuggestionCreated) {
    setOffer(null);
    onRuleCreated(created);
    const ids = Object.values(created.byCategory).flat();
    toast.show({
      message: tCat("ruleCreated", { count: created.categorized }),
      undo: {
        onUndo: async () => {
          try {
            const result = await undoRuleAction({ ruleId: created.ruleId, transactionIds: ids });
            if (result.status === "error") {
              toast.show({ message: tErrors("undoFailed"), variant: "error" });
              return;
            }
            onRulesUndone(result.cleared);
          } catch {
            toast.show({ message: navigator.onLine === false ? tErrors("offline") : tErrors("undoFailed"), variant: "error" });
          }
        },
      },
    });
  }

  function submitRule(draft: { matchType: string; pattern: string }) {
    if (!ruleDraft) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await categorizeTransaction({
          transactionId: item.id,
          categoryId: ruleDraft.categoryId,
          rule: draft,
        });
        if (result.status === "error") {
          setError(tErrors(result.error));
          return;
        }
        if (!result.ruleId) {
          setError(tErrors("saveFailed"));
          return;
        }
        const categorized = Object.values(result.retro).reduce((n, ids) => n + ids.length, 0);
        ruleCreated({ categorized, byCategory: result.retro, ruleId: result.ruleId });
        closeStep();
      } catch {
        setError(failed());
      }
    });
  }

  function splitSaved(patchValue: SplitPatch) {
    const previous = item.split;
    onSplitChanged(patchValue);
    patch(
      patchValue.split
        ? { split: patchValue.split, reviewed: true }
        : { split: null, category: patchValue.category ?? null, categorySource: patchValue.categorySource ?? null },
    );
    closeStep();
    const canRestore = previous === null || previous.parts.every((p) => p.category !== null);
    toast.show({
      message: patchValue.split ? t("splitSaved") : t("splitRemoved"),
      undo: canRestore
        ? {
            onUndo: async () => {
              try {
                const restored = await restoreSplitParts(item.id, previous, { saveSplitAction, removeSplitAction });
                if (!restored) {
                  toast.show({ message: tErrors("undoFailed"), variant: "error" });
                  return;
                }
                onSplitChanged(restored);
                patch(restored.split ? { split: restored.split } : { split: null, category: restored.category ?? null, categorySource: restored.categorySource ?? null });
              } catch {
                toast.show({ message: navigator.onLine === false ? tErrors("offline") : tErrors("undoFailed"), variant: "error" });
              }
            },
          }
        : undefined,
    });
  }

  /**
   * Sets the row aside or brings it back, with an Undo toast that does the reverse. Ignoring
   * closes the sheet (the row leaves the list); a refusal is a toast with Try again.
   */
  function changeIgnored(next: boolean) {
    const before = itemRef.current;
    startTransition(async () => {
      try {
        const result = await (next ? ignoreTransactionAction({ id: before.id }) : unignoreTransactionAction({ id: before.id }));
        if (result.status === "error") {
          const message = result.error === "inTransfer" ? tErrors("inTransfer") : result.error === "notFound" ? tErrors("notFound") : tErrors("saveFailed");
          toastFailure(message, () => changeIgnored(next));
          return;
        }
      } catch {
        toastFailure(failed(), () => changeIgnored(next));
        return;
      }
      // Ignoring marks the row reviewed; stopping leaves it as it was.
      patch(next ? { ignored: true, reviewed: true } : { ignored: false });
      onIgnoredChanged({ ...before, ignored: next, reviewed: before.reviewed || next }, next);
      toast.show({
        message: next ? t("ignoredToast") : t("unignoredToast"),
        undo: {
          onUndo: async () => {
            try {
              const reverted = await (next ? unignoreTransactionAction({ id: before.id }) : ignoreTransactionAction({ id: before.id }));
              if (reverted.status === "error") {
                toast.show({ message: tErrors("undoFailed"), variant: "error" });
                return;
              }
              onIgnoredChanged({ ...before, ignored: !next, reviewed: before.reviewed || next }, !next);
              if (!next) patch({ ignored: false });
            } catch {
              toast.show({ message: navigator.onLine === false ? tErrors("offline") : tErrors("undoFailed"), variant: "error" });
            }
          },
        },
      });
      if (next) close();
    });
  }

  /** "Paid with next month's money" (Slice 79): optimistic; a refusal puts the switch back and says so. */
  function changePaidNext(next: boolean) {
    const id = itemRef.current.id;
    patch({ paidFromNextMonth: next });
    onNoteTagsChanged({ id, paidFromNextMonth: next });
    void queue(async () => {
      let ok = false;
      try {
        ok = (await setPaidFromNextMonthAction({ id, on: next })).ok;
      } catch {
        ok = false;
      }
      if (ok) return;
      patch({ paidFromNextMonth: !next });
      onNoteTagsChanged({ id, paidFromNextMonth: !next });
      toast.show({ message: failed(), variant: "error" });
    });
  }

  /** Track as regular payment: the toast's Undo restores the item's earlier state (or removes the new one). */
  function track() {
    const before = itemRef.current;
    startTransition(async () => {
      try {
        const result = await trackRecurringAction(before.id);
        if (result.status === "error") {
          toastFailure(result.error, track);
          return;
        }
        patch({ recurring: { id: result.id, tracked: true } });
        toast.show({
          message: t("trackedToast"),
          undo: {
            onUndo: async () => {
              try {
                const reverted = await untrackRecurringAction({ id: result.id, restore: result.previous });
                if (reverted.status === "error") {
                  toast.show({ message: tErrors("undoFailed"), variant: "error" });
                  return;
                }
                patch({ recurring: result.previous ? { id: result.id, tracked: false } : null });
              } catch {
                toast.show({ message: navigator.onLine === false ? tErrors("offline") : tErrors("undoFailed"), variant: "error" });
              }
            },
          },
        });
      } catch {
        toastFailure(failed(), track);
      }
    });
  }

  function transferChanged(patches: TransferPatch[]) {
    onTransferChanged(patches);
    const own = patches.find((p) => p.id === item.id);
    if (own) patch({ transfer: own.transfer });
  }

  /** Both legs of a pair as list rows, seen from the sheet's row (`self`) and from its counterpart. */
  function pairPatches(transfer: NonNullable<TransactionListItem["transfer"]> | null, counterpartId: string | null, mirror?: NonNullable<TransactionListItem["transfer"]>): TransferPatch[] {
    return [{ id: item.id, transfer }, ...(counterpartId ? [{ id: counterpartId, transfer: mirror ?? null }] : [])];
  }

  function toListRow(
    linked: { id: string; status: "detected" | "confirmed" },
    other: { accountName: string; date: string; amountCents: number },
  ): NonNullable<TransactionListItem["transfer"]> {
    return { id: linked.id, status: linked.status, counterpartAccountName: other.accountName, counterpartDate: other.date, counterpartAmountCents: other.amountCents };
  }

  /** Move to savings succeeded: the row shows its transfer, and the toast offers Undo (which removes the created row, the rule and its moves). */
  function movedToSavings(moved: MovedToSavings) {
    const before = item;
    closeStep();
    const linked = moved.transfer;
    if (linked) {
      // The other leg is on a Savings account, which Reste à vivre never counts (Slice 79's "For next month").
      const own = { ...toListRow(linked, linked.counterpart), counterpartUncounted: true };
      patch({ transfer: own, reviewed: true });
      onTransferChanged(pairPatches(own, linked.counterpart.id, toListRow(linked, { accountName: before.accountName, date: before.date, amountCents: before.amountCents })));
    }
    const message = moved.goalName
      ? t("movedToGoal", { goal: moved.goalName, account: moved.accountName })
      : t(before.amountCents < 0 ? "movedToSavings" : "movedFromSavings", { account: moved.accountName });
    toast.show({
      message: moved.ruleId ? `${message} · ${t("savingsRuleAdded", { count: moved.pastMoved })}` : message,
      undo: linked
        ? {
            onUndo: async () => {
              try {
                const result = await removeSavingsMoveAction({ transferId: linked.id, ruleId: moved.ruleId ?? undefined });
                if (result.status === "error") {
                  toast.show({ message: tErrors("undoFailed"), variant: "error" });
                  return;
                }
                patch({ transfer: null });
                onTransferChanged(pairPatches(null, linked.counterpart.id));
              } catch {
                toast.show({ message: navigator.onLine === false ? tErrors("offline") : tErrors("undoFailed"), variant: "error" });
              }
            },
          }
        : undefined,
    });
  }

  /** The move was undone from the transfer step: the created row is gone; Undo moves the money again. */
  function moveRemoved(change: Extract<TransferChange, { kind: "unmove" }>) {
    closeStep();
    // The open row may itself be the created one: it no longer exists, so the sheet closes.
    if (item.id !== change.sourceId) close();
    toast.show({
      message: t("moveRemoved"),
      undo: {
        onUndo: async () => {
          try {
            const result = await moveToSavingsAction({ transactionId: change.sourceId, accountId: change.accountId, goalId: change.goalId, withRule: false });
            if (result.status === "error") {
              toast.show({ message: tErrors("undoFailed"), variant: "error" });
              return;
            }
            const linked = result.transfer;
            if (linked && item.id === change.sourceId) {
              patch({ transfer: toListRow(linked, linked.counterpart) });
              onTransferChanged(pairPatches(toListRow(linked, linked.counterpart), null));
            }
          } catch {
            toast.show({ message: navigator.onLine === false ? tErrors("offline") : tErrors("undoFailed"), variant: "error" });
          }
        },
      },
    });
  }

  function transferResult(change: TransferChange) {
    if (change.kind === "unmove") return moveRemoved(change);
    closeStep();
    const message = change.kind === "link" ? t("transferLinked") : change.kind === "confirm" ? t("transferConfirmed") : t("transferUnlinked");
    const before = item;
    toast.show({
      message,
      // A confirmation has no reverse action: unlinking would drop the pair altogether.
      undo:
        change.kind === "confirm"
          ? undefined
          : {
              onUndo: async () => {
                try {
                  const result =
                    change.kind === "link"
                      ? await unlinkTransferAction({ transferId: change.transferId, transactionId: before.id })
                      : await linkTransferAction({ transactionId: before.id, counterpartId: change.counterpartId });
                  if (result.status === "error") {
                    toast.show({ message: tErrors("undoFailed"), variant: "error" });
                    return;
                  }
                  const linked = result.transfer;
                  if (!linked) {
                    transferChanged([
                      { id: before.id, transfer: null },
                      ...(change.kind === "link" ? [{ id: change.counterpart.id, transfer: null }] : []),
                    ]);
                    return;
                  }
                  const toRow = (other: { accountName: string; date: string; amountCents: number }): NonNullable<TransactionListItem["transfer"]> => ({
                    id: linked.id,
                    status: linked.status,
                    counterpartAccountName: other.accountName,
                    counterpartDate: other.date,
                    counterpartAmountCents: other.amountCents,
                  });
                  transferChanged([
                    { id: before.id, transfer: toRow(linked.counterpart) },
                    { id: linked.counterpart.id, transfer: toRow({ accountName: before.accountName, date: before.date, amountCents: before.amountCents }) },
                  ]);
                } catch {
                  toast.show({ message: navigator.onLine === false ? tErrors("offline") : tErrors("undoFailed"), variant: "error" });
                }
              },
            },
    });
  }

  function merchantSaved(saved: RenameSaved) {
    const before = item;
    closeStep();
    patch({ label: saved.name, merchant: saved.merchantId ? { id: saved.merchantId, name: saved.name } : before.merchant });
    onMerchantRenamed?.();
    const undoable = saved.created ? saved.merchantId : saved.patternId;
    toast.show({
      message: tMerchant("renamed", { count: saved.rowsRenamed }),
      undo: undoable
        ? {
            onUndo: async () => {
              try {
                const result = saved.created ? await deleteMerchantAction(saved.merchantId) : await removePatternAction(saved.patternId);
                if (result.status === "error") {
                  toast.show({ message: tErrors("undoFailed"), variant: "error" });
                  return;
                }
                patch({ label: before.label, merchant: before.merchant });
                onMerchantRenamed?.();
              } catch {
                toast.show({ message: navigator.onLine === false ? tErrors("offline") : tErrors("undoFailed"), variant: "error" });
              }
            },
          }
        : undefined,
    });
  }

  const sourceText =
    item.categorySource === "rule"
      ? tCat("setByRule")
      : item.categorySource === "bank"
        ? tCat("setFromBank")
        : item.categorySource === "guess"
          ? tCat("setByGuess")
          : item.categorySource === "manual"
            ? tCat("setManually")
            : null;

  const bankLabel = item.bankLabel && item.bankLabel !== name ? item.bankLabel : null;
  const dateLine = [formatDay(item.date, today, locale), showAccount ? item.accountName : null].filter(Boolean).join(" · ");
  // Slice 79: only this month's plain expenses, and only while an income is kept; a switched row can always be switched off.
  // Slice 79: an incoming transfer from an account left out of Reste à vivre (money taken from savings) can be kept for next month too.
  const paidNextIn = item.amountCents > 0 && item.transfer?.counterpartUncounted === true;
  const showPaidNext =
    keepsIncome &&
    (item.paidFromNextMonth ||
      (item.date.slice(0, 7) === today.slice(0, 7) &&
        !item.ignored &&
        (paidNextIn || (item.amountCents < 0 && item.transfer === null && !item.split))));
  const nextMonthName = inSentence(formatMonthName(addMonths(today.slice(0, 7), 1), locale), locale);
  const canSplit = item.transfer === null && item.amountCents !== 0;
  // A free outflow or inflow on a current account, when there is a Savings account to put it on.
  const canMoveToSavings =
    savingsAccounts.length > 0 &&
    item.transfer === null &&
    !item.split &&
    !item.ignored &&
    item.amountCents !== 0 &&
    item.origin.source !== "franc" &&
    !savingsAccounts.some((a) => a.id === item.accountId);
  const canTrack =
    !item.ignored && item.amountCents !== 0 && item.transfer === null && item.origin.source !== "franc" && !item.recurring?.tracked;
  const trackedId = item.recurring?.tracked ? item.recurring.id : null;
  const transferDetail = item.transfer
    ? item.transfer.status === "confirmed"
      ? t("linkedTo", { account: item.transfer.counterpartAccountName })
      : t("possibleTransfer", { account: item.transfer.counterpartAccountName })
    : null;

  const isManual = item.origin.source === "manual";
  const originLine =
    item.origin.source === "manual"
      ? item.origin.awaitingBank
        ? t("originManualWaiting")
        : t("originManual")
      : item.origin.importKind === "franc" && item.origin.source !== "franc"
        ? t("originAdopted")
        : item.origin.source === "franc"
          ? t("originFranc")
          : item.origin.source === "sync"
            ? t("originSync")
            : t("originCsv", { date: formatShortInstant(item.origin.importedAt, today, locale) });

  const categoryLabel = item.category ? categoryPath(item.category) : tGlossary("uncategorized");

  const stepNode = (() => {
    switch (step) {
      case "category":
        return (
          <StepFrame
            title={pickerCreating ? tPicker("newCategory") : t("categoryStep")}
            onBack={pickerCreating ? () => setPickerCreating(false) : closeStep}
          >
            <CategoryPickerList
              categories={categories}
              currentId={item.category?.id ?? null}
              onPick={pickCategory}
              creating={pickerCreating}
              onCreatingChange={setPickerCreating}
            />
          </StepFrame>
        );
      case "split":
        return (
          <StepFrame title={tSplit("button")} onBack={closeStep}>
            <SplitEditor item={item} categories={categories} onSaved={splitSaved} onCancel={closeStep} />
          </StepFrame>
        );
      case "transfer":
        return (
          <StepFrame title={tTransfer("heading")} onBack={closeStep}>
            <TransferSection item={item} onChanged={transferChanged} onResult={transferResult} showHeading={false} savingsAccounts={savingsAccounts} />
          </StepFrame>
        );
      case "edit":
        return (
          <StepFrame title={t("edit")} onBack={closeStep}>
            <ManualForm
              values={manualValues}
              onChange={setManualValues}
              today={today}
              submitLabel={tAdd("save")}
              pending={isPending}
              error={manualError}
              onSubmit={saveManualEdit}
            />
          </StepFrame>
        );
      case "savings":
        return (
          <StepFrame title={item.amountCents < 0 ? tActions("moveToSavings") : tActions("moveFromSavings")} onBack={closeStep}>
            <SavingsStep item={item} accounts={savingsAccounts.filter((a) => a.id !== item.accountId)} onMoved={movedToSavings} />
          </StepFrame>
        );
      case "rename":
        return (
          <StepFrame title={tMerchant("button")} onBack={closeStep}>
            <RenameMerchantForm
              currentName={item.merchant?.name ?? null}
              shortLabel={item.shortLabel}
              merchantNames={merchantNames}
              onCancel={closeStep}
              onSaved={merchantSaved}
            />
          </StepFrame>
        );
      case "rule":
        return ruleDraft ? (
          <StepFrame title={t("rule.stepTitle")} onBack={closeStep}>
            <RuleForm
              initial={{ matchType: ruleDraft.matchType, pattern: ruleDraft.pattern }}
              categoryName={ruleDraft.categoryName}
              pending={isPending}
              error={error}
              onSubmit={submitRule}
              onCancel={closeStep}
            />
          </StepFrame>
        ) : null;
      default:
        return null;
    }
  })();

  return (
    <SheetContent
      className="theme-50f"
      title={
        <span className="flex items-center gap-3">
          <TransactionAvatar name={name} category={item.category} split={item.split !== null} transfer={item.transfer !== null} />
          <span className="min-w-0 break-words">{name}</span>
        </span>
      }
      description={
        <span className="flex flex-col gap-1">
          <span
            data-testid="sheet-amount"
            className={cn("text-4xl leading-none font-bold tracking-tight tabular-nums", item.amountCents > 0 ? "text-positive" : "text-foreground")}
          >
            {formatSignedCents(item.amountCents, locale)}
          </span>
          <span>{dateLine}</span>
          {bankLabel && <span className="text-xs break-words">{tMerchant("bankLabel", { label: bankLabel })}</span>}
          <span data-testid="sheet-origin" className="text-xs">
            {originLine}
          </span>
        </span>
      }
      data-testid="transaction-sheet"
      onEscapeKeyDown={(e) => {
        // Escape backs out of a step first, and only then closes the sheet.
        if (stepOpen.current) {
          e.preventDefault();
          closeStep();
        }
      }}
      onOpenAutoFocus={(e) => {
        if (initialSection === "note" && step === null) {
          e.preventDefault();
          noteField.current?.focus({ preventScroll: true });
        } else if (step !== null) {
          // The step's heading takes focus itself.
          e.preventDefault();
        }
      }}
    >
      {/* Hidden, not unmounted, behind a step: the note keeps its text and Back finds its row again. */}
      <div className={cn("flex flex-col gap-5", step !== null && "hidden")}>
        <LoanLine item={item} />
        {categories.length === 0 ? (
          <NoCategoriesHint />
        ) : item.split ? (
          <button
            type="button"
            data-testid="sheet-split-parts"
            onClick={(e) => openStep("split", e)}
            className="hover:bg-muted focus-visible:ring-ring/50 -mx-3 flex min-h-12 items-start gap-3 rounded-xl px-3 py-2 text-left outline-none focus-visible:ring-[3px]"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-muted-foreground text-sm font-medium">{t("splitParts")}</span>
              {item.split.parts.map((p) => (
                <span key={p.id} className="flex items-center justify-between gap-3 text-base">
                  <span className="truncate">{p.category ? categoryPath(p.category) : tGlossary("uncategorized")}</span>
                  <span className="shrink-0 tabular-nums">
                    {p.amountCents < 0 ? formatCents(-p.amountCents, locale) : formatSignedCents(p.amountCents, locale)}
                  </span>
                </span>
              ))}
            </span>
            <ChevronRight aria-hidden="true" className="text-muted-foreground mt-1 size-5 shrink-0" />
          </button>
        ) : (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              data-testid="sheet-category"
              aria-label={t("categoryRow", { category: categoryLabel })}
              onClick={(e) => openStep("category", e)}
              className="hover:bg-muted focus-visible:ring-ring/50 -mx-3 flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-base outline-none focus-visible:ring-[3px]"
            >
              {item.category ? (
                <CategoryMarker icon={item.category.icon} color={item.category.color} />
              ) : (
                <span aria-hidden="true" className="text-muted-foreground size-3 shrink-0 rounded-full" style={{ boxShadow: "inset 0 0 0 1px currentColor" }} />
              )}
              <span className="min-w-0 flex-1 font-medium break-words">{categoryLabel}</span>
              <ChevronRight aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
            </button>
            {sourceText && (
              <p className="text-muted-foreground flex items-center gap-1 text-xs">
                {item.categorySource === "guess" && <Sparkles aria-hidden="true" className="size-3" />}
                {sourceText}
              </p>
            )}
            {/* With a category, the row above changes it: the pills only help a row that has none. */}
            {!item.category && (
              <div data-testid="sheet-suggestions" role="group" aria-label={t("suggestions")} className="mt-1 flex flex-wrap gap-2">
                {pillCategories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      data-testid="sheet-suggestion"
                      disabled={isPending}
                      onClick={() => pickCategory(c.id)}
                      className="bg-secondary hover:bg-muted focus-visible:ring-ring/50 min-h-11 max-w-full truncate rounded-full px-4 text-sm outline-none focus-visible:ring-[3px]"
                    >
                      {c.label}
                    </button>
                  ))}
                <button
                  type="button"
                  data-testid="sheet-new-category"
                  onClick={(e) => {
                    openStep("category", e);
                    setPickerCreating(true);
                  }}
                  className="text-primary hover:bg-muted focus-visible:ring-ring/50 min-h-11 rounded-full border border-dashed px-4 text-sm outline-none focus-visible:ring-[3px]"
                >
                  {t("newCategory")}
                </button>
              </div>
            )}
            {validatable && item.category && (
              <Button type="button" data-testid="sheet-validate" className="mt-2 h-12" disabled={isPending} onClick={guessed ? keepGuess : validateHere}>
                {t("validateIn", { category: item.category.name })}
              </Button>
            )}
          </div>
        )}

        {offer && (
          <RuleProposalCard
            key={`${offer.kind}:${offerDraft(offer).pattern}:${offerDraft(offer).categoryId}`}
            offer={offer}
            onCreated={ruleCreated}
            onAdjust={() => {
              setRuleDraft(offerDraft(offer));
              openStep("rule");
            }}
            onDismissed={() => setOffer(null)}
          />
        )}

        {/* Own autosave: works with or without categories. */}
        <div data-testid="note-section" className="flex flex-col gap-4">
          <NoteForm
            transactionId={item.id}
            initialNote={item.note}
            textareaRef={noteField as Ref<HTMLTextAreaElement>}
            onSaved={(note) => {
              patch({ note });
              onNoteTagsChanged({ id: item.id, note });
            }}
          />
          <TagsEditor
            transactionId={item.id}
            initialTags={item.tags}
            tagNames={tagNames}
            onChanged={(tags) => {
              patch({ tags });
              onNoteTagsChanged({ id: item.id, tags });
            }}
          />
        </div>

        <div className="-mx-3 flex flex-col border-t pt-2">
          <ActionRow testId="sheet-rename" icon={<Tag className="size-5" />} label={tMerchant("button")} onClick={(e) => openStep("rename", e)} />
          {canSplit && !item.split && (
            <ActionRow testId="sheet-split" icon={<Split className="size-5" />} label={tActions("split")} onClick={(e) => openStep("split", e)} />
          )}
          {showAccount && (
            <ActionRow
              testId="sheet-transfer"
              icon={<ArrowLeftRight className="size-5" />}
              label={tActions("transfer")}
              detail={transferDetail}
              onClick={(e) => openStep("transfer", e)}
            />
          )}
          {canMoveToSavings && (
            <ActionRow
              testId="sheet-savings"
              icon={<PiggyBank className="size-5" />}
              label={item.amountCents < 0 ? tActions("moveToSavings") : tActions("moveFromSavings")}
              onClick={(e) => openStep("savings", e)}
            />
          )}
          {trackedId ? (
            <ActionRow
              testId="sheet-recurring"
              icon={<Repeat className="size-5" />}
              label={tActions("tracked")}
              detail={tActions("trackedDetail")}
              onClick={() => router.push(`/recurring?item=${trackedId}`)}
            />
          ) : (
            canTrack && (
              <ActionRow
                testId="sheet-track"
                icon={<Repeat className="size-5" />}
                label={tActions("track")}
                detail={tActions("trackDetail")}
                onClick={track}
              />
            )
          )}
          {isManual && (
            <ActionRow testId="sheet-edit" icon={<Pencil className="size-5" />} label={t("edit")} onClick={(e) => openStep("edit", e)} />
          )}
        </div>
        {showPaidNext && (
          <label
            data-testid="sheet-paid-next"
            className="-mx-3 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left text-base"
          >
            <span aria-hidden="true" className="text-muted-foreground flex size-5 shrink-0 items-center justify-center">
              <CalendarClock className="size-5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{t(paidNextIn ? "paidNextIn" : "paidNext", { month: nextMonthName })}</span>
              <span className="text-muted-foreground text-sm break-words">
                {t(
                  paidNextIn
                    ? item.paidFromNextMonth ? "paidNextInOn" : "paidNextInOff"
                    : item.paidFromNextMonth ? "paidNextOn" : "paidNextOff",
                  { month: nextMonthName },
                )}
              </span>
            </span>
            {/* A native checkbox drawn as a switch, like the regular payment sheet's: keeps keyboard and test semantics. */}
            <input
              type="checkbox"
              role="switch"
              className="bg-gauge-off checked:bg-primary after:bg-foreground relative h-6 w-10 shrink-0 cursor-pointer appearance-none rounded-full transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:transition-transform checked:after:translate-x-4"
              checked={item.paidFromNextMonth}
              onChange={(e) => changePaidNext(e.target.checked)}
            />
          </label>
        )}
        {/* Delete and Ignore leave the row out of the books: their own amber card, a gap away from the thumb's usual targets. */}
        <div data-testid="sheet-danger-zone" className="border-warning/40 -mx-3 flex flex-col rounded-xl border">
          {isManual && (
            <ActionRow testId="sheet-delete" icon={<Trash2 className="size-5" />} label={t("delete")} onClick={deleteManual} />
          )}
          {/* A row added by hand is deleted, not ignored: there is no bank row to keep out. */}
          {!isManual && (
            <ActionRow
              testId={item.ignored ? "sheet-unignore" : "sheet-ignore"}
              icon={item.ignored ? <Eye className="size-5" /> : <EyeOff className="size-5" />}
              label={item.ignored ? t("unignore") : t("ignore")}
              detail={item.ignored ? t("unignoreDetail") : t("ignoreDetail")}
              onClick={() => changeIgnored(!item.ignored)}
            />
          )}
        </div>
      </div>
      {stepNode}
      <ToastViewport inSheet />
    </SheetContent>
  );
}
