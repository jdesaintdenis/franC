"use client";

import { Check, CircleHelp, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useTransition, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { RuleSuggestionLine, type SuggestionCreated } from "@/components/rule-suggestion-line";
import { Label } from "@/components/ui/label";
import { NATIVE_SELECT_CLASS } from "@/components/ui/native-select";
import type { RuleSuggestionDetails } from "@/db/queries/guess";
import type { ReviewQueueItem } from "@/db/queries/review";
import type { CategoryOption } from "@/lib/categorize/hierarchy";
import { findCategoryRef } from "@/lib/optimistic/category";
import { createSerialQueue } from "@/lib/optimistic/queue";
import { hasDestination } from "@/lib/transactions/validation";
import { groupByImport } from "@/lib/review/group";
import { mergeRestored, nextCurrentId } from "@/lib/review/queue";
import { shortcutFor } from "@/lib/review/shortcuts";

import { bulkCategorize, categorizeTransaction } from "../transactions/actions";
import { useCategoryChangeToast, useMovedMessage } from "../transactions/category-change";
import type { SavingsAccountOption } from "../transactions/savings-step";
import { CategoryPickerSheet } from "../transactions/category-picker-sheet";
import { NEW_CATEGORY_VALUE, NewCategorySheet } from "../transactions/new-category-sheet";
import type { CategorizedResult, CategoryRestore, NoteTagsPatch, SheetSection } from "../transactions/sheet-types";
import { TransactionSheet } from "../transactions/transaction-sheet";
import type { SplitPatch } from "../transactions/split-editor";
import type { TransferPatch } from "../transactions/transfer-section";
import { acceptGuessAction, guessCategoriesAction, keepBothAction, markReviewedAction, mergeDuplicateAction, undoReviewedAction } from "./actions";
import { ReviewCard } from "./review-card";
import { ReviewList } from "./review-list";
import { ShortcutHelp } from "./shortcut-help";

/** More than this many rows asks for confirmation before "Mark all as reviewed". */
const CONFIRM_ALL_ABOVE = 20;
// Mirrors the server action limits.
const MAX_IDS = 500;

interface Props {
  initialItems: ReviewQueueItem[];
  /** Everything waiting for review; can exceed `initialItems` (capped server-side). */
  initialTotal: number;
  categories: CategoryOption[];
  merchantNames: string[];
  /** The user's tag names, suggested in the dialog's tags editor. */
  tagNames: string[];
  /** True when the user has several accounts. */
  showAccount: boolean;
  /** The user's Savings accounts, offered by Move to savings. */
  savingsAccounts: SavingsAccountOption[];
  /** Changes when merchants change server-side: loaded rows are replaced by fresh ones. */
  dataVersion: string;
  /** Shown under the header whatever the queue holds ("Not found in your bank", Slice 56). */
  notFound?: ReactNode;
}

/** What a save reports back: the ids the server changed (for Undo), or the message to show. */
type Outcome = { status: "done"; ids: string[] } | { status: "error"; message: string };

/** Filled in when the save finishes; Undo waits for the queue, so it always sees the ids. */
interface SavedIds {
  ids: string[];
}

interface LeaveContext {
  holder: SavedIds;
  /** The rows as they were, to put back when the save fails. */
  originals: ReviewQueueItem[];
  /** The rows as Undo of the toast puts them back (with any edit the change made). */
  restoreRows: ReviewQueueItem[];
  /** How much the waiting count went down. */
  subtracted: number;
}

export function ReviewQueue({ initialItems, initialTotal, categories, merchantNames, tagNames, showAccount, savingsAccounts, dataVersion, notFound }: Props) {
  const router = useRouter();
  const t = useTranslations("transactions.review");
  const nav = useTranslations("common.nav");
  const tGlossary = useTranslations("common.glossary");
  const tActions = useTranslations("common.actions");
  const tBulk = useTranslations("transactions.review.bulk");
  const tErrors = useTranslations("transactions.review.errors");
  const tCatErrors = useTranslations("transactions.errors");
  const showCategoryToast = useCategoryChangeToast();
  const movedMessage = useMovedMessage();
  const toast = useToast();
  const tToast = useTranslations("common.toast");

  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [seenVersion, setSeenVersion] = useState(dataVersion);
  if (seenVersion !== dataVersion) {
    setSeenVersion(dataVersion);
    setItems(initialItems);
    setTotal(initialTotal);
  }
  // "Guess categories" re-queues rows server-side: the first fresh props after it replace the loaded rows.
  // Only then, so ordinary marks (which also re-render the page) keep the local queue as it is.
  const [resyncFrom, setResyncFrom] = useState<ReviewQueueItem[] | null>(null);
  if (resyncFrom !== null && resyncFrom !== initialItems) {
    setResyncFrom(null);
    setItems(initialItems);
    setTotal(initialTotal);
  }
  const [currentId, setCurrentId] = useState<string | null>(initialItems[0]?.id ?? null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<{ item: ReviewQueueItem; section: SheetSection | undefined } | null>(null);
  const [suggestion, setSuggestion] = useState<RuleSuggestionDetails | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkCreating, setBulkCreating] = useState(false);
  const [busy, startTransition] = useTransition();
  const [pickerItem, setPickerItem] = useState<ReviewQueueItem | null>(null);
  const pickerRef = useRef<HTMLButtonElement>(null);
  // Rows that left the queue, so Undo of a category change can put them back where they were.
  const stash = useRef(new Map<string, ReviewQueueItem>());
  // Every save and Undo goes through one queue: an Undo tapped while its save is on the way reaches the server after it.
  const [queue] = useState(createSerialQueue);
  // The latest rows, for saves that finish later and for "Try again".
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // The Undo of the toast on screen, for the keyboard shortcut.
  const lastUndo = useRef<(() => void) | null>(null);

  const foundIndex = items.findIndex((i) => i.id === currentId);
  const index = foundIndex < 0 ? 0 : foundIndex;
  const current = items[index] ?? null;
  const groups = useMemo(() => groupByImport(items), [items]);

  function failureMessage(message: string = tErrors("failed")) {
    return navigator.onLine === false ? tErrors("offline") : message;
  }

  function errorToast(message: string, retry: () => void) {
    toast.show({ message, variant: "error", action: { label: tToast("retry"), onAction: retry } });
  }

  /** Takes rows out of the queue at once; `patched` carries the edits Undo should bring back. */
  function removeFromQueue(removeIds: ReadonlySet<string>, patched?: ReadonlyMap<string, ReviewQueueItem>, subtract?: number) {
    const before = itemsRef.current;
    const originals = before.filter((i) => removeIds.has(i.id));
    const restoreRows = originals.map((i) => patched?.get(i.id) ?? i);
    if (originals.length === 0) return null;
    for (const row of restoreRows) stash.current.set(row.id, row);
    // Kept in step here too: a second tap before the next render must not see these rows again.
    itemsRef.current = before.filter((i) => !removeIds.has(i.id));
    setCurrentId((cur) => nextCurrentId(before, removeIds, cur ?? current?.id ?? null));
    setItems((prev) => prev.filter((i) => !removeIds.has(i.id)));
    setChecked((prev) => new Set([...prev].filter((id) => !removeIds.has(id))));
    const subtracted = subtract ?? originals.length;
    setTotal((n) => Math.max(0, n - subtracted));
    return { originals, restoreRows, subtracted };
  }

  /** A failed save: the rows come back where they were. */
  function putBack({ originals, restoreRows, subtracted }: Omit<LeaveContext, "holder">) {
    for (const row of restoreRows) stash.current.delete(row.id);
    itemsRef.current = mergeRestored(itemsRef.current, originals);
    setItems((prev) => mergeRestored(prev, originals));
    setCurrentId(originals[0]?.id ?? null);
    setTotal((n) => n + subtracted);
  }

  /** "Marked N as reviewed" with Undo. Undo waits for the save, then puts the rows back. */
  function showMarked(count: number, skipped: number, { holder, restoreRows }: LeaveContext) {
    const run = () => undoMarked(holder, restoreRows);
    lastUndo.current = run;
    const marked = t("status.marked", { count });
    toast.show({ message: skipped > 0 ? `${marked} · ${t("status.skipped", { count: skipped })}` : marked, undo: { onUndo: run } });
  }

  function undoMarked(holder: SavedIds, rows: ReviewQueueItem[]) {
    const undoFailed = () => toast.show({ message: failureMessage(tCatErrors("undoFailed")), variant: "error" });
    queue(async () => {
      const ids = holder.ids;
      // The save failed or changed nothing: the rows are already back, or were never waiting.
      if (ids.length === 0) return;
      let restored = 0;
      for (let i = 0; i < ids.length; i += MAX_IDS) {
        const result = await undoReviewedAction({ ids: ids.slice(i, i + MAX_IDS) });
        if (result.status === "error") return undoFailed();
        restored += result.restored;
      }
      // Rows beyond the loaded page cannot be put back locally: reload to see them.
      if (restored > rows.length) {
        window.location.reload();
        return;
      }
      itemsRef.current = mergeRestored(itemsRef.current, rows);
      setItems((prev) => mergeRestored(prev, rows));
      setCurrentId(rows[0]?.id ?? null);
      setTotal((n) => n + restored);
      toast.show({ message: t("status.restored", { count: restored }) });
    }).catch(undoFailed);
  }

  /**
   * Rows leave the queue and the toast shows now; the save follows behind. If it fails the rows come
   * back and an error toast offers Try again.
   */
  function leaveOptimistically(opts: {
    removeIds: ReadonlySet<string>;
    patched?: ReadonlyMap<string, ReviewQueueItem>;
    subtract?: number;
    save: () => Promise<Outcome>;
    announce?: (context: LeaveContext) => void;
    retry: () => void;
    /** Shown when the call could not reach the server (offline wording takes over when offline). */
    failMessage?: string;
  }) {
    const removed = removeFromQueue(opts.removeIds, opts.patched, opts.subtract);
    if (!removed) return;
    const holder: SavedIds = { ids: [] };
    const context: LeaveContext = { holder, ...removed };
    (opts.announce ?? ((c) => showMarked(c.subtracted, 0, c)))(context);
    const fail = (message: string) => {
      putBack(removed);
      errorToast(failureMessage(message), opts.retry);
    };
    queue(opts.save).then(
      (outcome) => {
        if (outcome.status === "done") holder.ids = outcome.ids;
        else fail(outcome.message);
      },
      () => fail(opts.failMessage ?? tErrors("failed")),
    );
  }

  /** A change the server already made (split, transfer): rows leave, with the same Undo toast. */
  function confirmedLeave(removeIds: ReadonlySet<string>, patched?: ReadonlyMap<string, ReviewQueueItem>) {
    const removed = removeFromQueue(removeIds, patched);
    if (!removed) return;
    showMarked(removed.subtracted, 0, { holder: { ids: [...removeIds] }, ...removed });
  }

  async function markCall(input: Parameters<typeof markReviewedAction>[0]): Promise<Outcome> {
    const result = await markReviewedAction(input);
    return result.status === "error" ? { status: "error", message: tErrors(result.error) } : { status: "done", ids: result.ids };
  }

  /** Rows that say where their money went leave; the others stay (SPEC §73 A) and the toast says how many. */
  function leavingRows(rows: readonly ReviewQueueItem[]): ReviewQueueItem[] {
    const leaving = rows.filter(hasDestination);
    const staying = rows.length - leaving.length;
    if (staying > 0) toast.show({ message: t("status.withoutCategory", { count: staying }) });
    return leaving;
  }

  function markIds(ids: string[]) {
    const leaving = leavingRows(itemsRef.current.filter((i) => ids.includes(i.id)));
    if (leaving.length === 0) return;
    ids = leaving.map((i) => i.id);
    leaveOptimistically({
      removeIds: new Set(ids),
      save: () => markCall({ ids: ids.slice(0, MAX_IDS) }),
      retry: () => markIds(ids),
    });
  }

  function markImport(importId: string) {
    const leaving = leavingRows(itemsRef.current.filter((i) => i.import.id === importId));
    if (leaving.length === 0) return;
    leaveOptimistically({
      removeIds: new Set(leaving.map((i) => i.id)),
      save: () => markCall({ importId }),
      retry: () => markImport(importId),
    });
  }

  function markAll() {
    setConfirmAllOpen(false);
    const loaded = itemsRef.current;
    const leaving = leavingRows(loaded);
    if (leaving.length === 0) return;
    leaveOptimistically({
      removeIds: new Set(leaving.map((i) => i.id)),
      // Rows beyond the loaded page leave the count too; the loaded ones without a category stay in it.
      subtract: Math.max(total, loaded.length) - (loaded.length - leaving.length),
      save: () => markCall({ all: true }),
      retry: markAll,
    });
  }

  function requestMarkAll() {
    if (total > CONFIRM_ALL_ABOVE) setConfirmAllOpen(true);
    else markAll();
  }

  /** Accepting a guess makes it a hand categorization (manual), marks the row reviewed and moves on. */
  function acceptGuess(item: ReviewQueueItem) {
    if (item.categorySource !== "guess" || item.split) return;
    leaveOptimistically({
      removeIds: new Set([item.id]),
      patched: new Map([[item.id, { ...item, categorySource: "manual" as const }]]),
      save: async () => {
        const result = await acceptGuessAction({ transactionId: item.id });
        if (result.status === "error") return { status: "error", message: result.error === "notFound" ? tErrors("failed") : tErrors(result.error) };
        setSuggestion(result.ruleSuggestion ?? null);
        return { status: "done", ids: [item.id] };
      },
      retry: () => acceptGuess(item),
    });
  }

  /**
   * "Same transaction": the row leaves the queue and the server deletes it. There is no Undo: the
   * row no longer exists (its identity now lives on the kept transaction), so there is nothing to restore.
   */
  function mergeDuplicate(item: ReviewQueueItem, candidateId: string) {
    const removed = removeFromQueue(new Set([item.id]));
    if (!removed) return;
    lastUndo.current = null;
    // Deleted rows are never put back by a later Undo of another toast.
    stash.current.delete(item.id);
    toast.show({ message: t("status.merged") });
    const fail = (message: string) => {
      putBack(removed);
      errorToast(failureMessage(message), () => mergeDuplicate(item, candidateId));
    };
    queue(async () => {
      const result = await mergeDuplicateAction({ id: item.id, candidateId });
      if (result.status === "error") fail(tErrors(result.error));
    }).catch(() => fail(tErrors("failed")));
  }

  /** "Keep both": the card stays (still to review) without the possible-duplicate section. */
  function keepBothDuplicates(item: ReviewQueueItem) {
    const clear = (rows: ReviewQueueItem[], possibleDuplicates: ReviewQueueItem["possibleDuplicates"]) =>
      rows.map((i) => (i.id === item.id ? { ...i, possibleDuplicates } : i));
    itemsRef.current = clear(itemsRef.current, []);
    setItems((prev) => clear(prev, []));
    toast.show({ message: t("status.keptBoth") });
    const fail = (message: string) => {
      itemsRef.current = clear(itemsRef.current, item.possibleDuplicates);
      setItems((prev) => clear(prev, item.possibleDuplicates));
      errorToast(failureMessage(message), () => keepBothDuplicates(item));
    };
    queue(async () => {
      const result = await keepBothAction({ id: item.id });
      if (result.status === "error") fail(tErrors(result.error));
    }).catch(() => fail(tErrors("failed")));
  }

  /** "Guess categories": rules, bank mappings, then guesses; newly guessed rows come back to the queue. */
  function guessAll() {
    setResyncFrom(initialItems);
    startTransition(async () => {
      try {
        const result = await guessCategoriesAction();
        if (result.status === "error") {
          setResyncFrom(null);
          errorToast(failureMessage(tErrors(result.error)), guessAll);
          return;
        }
        const total = result.rules + result.bank + result.guessed;
        lastUndo.current = null;
        toast.show({ message: t("guess.result", { total, rules: result.rules, bank: result.bank, guessed: result.guessed }) });
        router.refresh();
      } catch {
        setResyncFrom(null);
        errorToast(failureMessage(), guessAll);
      }
    });
  }

  /** A rule was created from the suggestion: the loaded rows it categorized show their new category. */
  function onRuleCreated(created: SuggestionCreated) {
    const byId = new Map<string, NonNullable<ReviewQueueItem["category"]>>();
    for (const [categoryId, ids] of Object.entries(created.byCategory)) {
      const option = categories.find((c) => c.id === categoryId);
      if (!option) continue;
      for (const id of ids) byId.set(id, { id: option.id, name: option.name, color: option.color, icon: option.icon, parentName: option.parentName });
    }
    if (byId.size > 0) {
      setItems((prev) => prev.map((i) => (byId.has(i.id) ? { ...i, category: byId.get(i.id) ?? null, categorySource: "rule" as const } : i)));
    }
    router.refresh();
  }

  /** Picking a category in the list: the row leaves and "Moved to X" shows now; the save follows. */
  function recategorize(item: ReviewQueueItem, categoryId: string | null, created?: CategoryOption) {
    const category = findCategoryRef(created ? [created] : categories, categoryId);
    const moveFailed = tCatErrors("moveFailed", { category: category?.name ?? tGlossary("uncategorized") });
    leaveOptimistically({
      removeIds: new Set([item.id]),
      patched: new Map([[item.id, { ...item, category, categorySource: category ? ("manual" as const) : null }]]),
      announce: () => showCategoryToast(item, movedMessage(category), restoreIntoQueue, queue),
      save: async () => {
        const result = await categorizeTransaction({ transactionId: item.id, categoryId });
        if (result.status === "error") return { status: "error", message: moveFailed };
        setSuggestion(result.ruleSuggestion ?? null);
        return { status: "done", ids: [item.id] };
      },
      failMessage: moveFailed,
      retry: () => recategorize(item, categoryId, created),
    });
  }

  /** Undo of a category change: the server put the row back to unreviewed, so it returns to its place in the queue. */
  function restoreIntoQueue(restore: CategoryRestore) {
    const row = stash.current.get(restore.id);
    if (!row) return;
    stash.current.delete(restore.id);
    const back = { ...row, category: restore.category, categorySource: restore.categorySource, reviewed: false };
    itemsRef.current = mergeRestored(itemsRef.current, [back]);
    setItems((prev) => mergeRestored(prev, [back]));
    setCurrentId(restore.id);
    setTotal((n) => n + 1);
  }

  function applyBulkCategory(categoryId: string | null, ids: string[] = [...checked].slice(0, MAX_IDS), created?: CategoryOption) {
    if (ids.length === 0) return;
    const category = findCategoryRef(created ? [created] : categories, categoryId);
    // Split rows are skipped by the server, so they stay in the queue.
    const done = itemsRef.current.filter((i) => ids.includes(i.id) && !i.split);
    const skipped = ids.length - done.length;
    setBulkCategory("");
    if (done.length === 0) {
      toast.show({ message: t("status.skipped", { count: skipped }) });
      return;
    }
    const doneIds = done.map((i) => i.id);
    leaveOptimistically({
      removeIds: new Set(doneIds),
      patched: new Map(done.map((i) => [i.id, { ...i, category, categorySource: category ? ("manual" as const) : null }])),
      announce: (context) => showMarked(context.subtracted, skipped, context),
      save: async () => {
        const result = await bulkCategorize({ transactionIds: ids, categoryId });
        if (result.status === "error") return { status: "error", message: tCatErrors(result.error) };
        setSuggestion(result.ruleSuggestion ?? null);
        return { status: "done", ids: doneIds };
      },
      failMessage: tCatErrors("saveFailed"),
      retry: () => applyBulkCategory(categoryId, ids, created),
    });
  }

  // Sheet callbacks. A category change leaves the queue; the sheet stays open on the row it just changed.
  const onCategorized = (edited: ReviewQueueItem, result: CategorizedResult) => {
    const retro = new Map<string, NonNullable<ReviewQueueItem["category"]>>();
    for (const [categoryId, ids] of Object.entries(result.retro)) {
      const category = result.retroCategories[categoryId];
      if (category) for (const id of ids) retro.set(id, category);
    }
    if (retro.size > 0) {
      setItems((prev) => prev.map((i) => (retro.has(i.id) && i.id !== edited.id ? { ...i, category: retro.get(i.id) ?? null, categorySource: "rule" } : i)));
    }
    // The sheet shows its own rule offer, its own toast and its own save.
    setSuggestion(null);
    removeFromQueue(new Set([edited.id]), new Map([[edited.id, { ...edited, category: result.category, categorySource: result.categorySource }]]));
  };

  const onSplitChanged = (patch: SplitPatch) => {
    if (patch.split) {
      // A saved split counts as categorizing: the server marked the row reviewed.
      const item = items.find((i) => i.id === patch.id);
      if (item) confirmedLeave(new Set([patch.id]), new Map([[patch.id, { ...item, split: patch.split }]]));
      return;
    }
    setItems((prev) =>
      prev.map((i) => (i.id === patch.id ? { ...i, split: null, category: patch.category ?? null, categorySource: patch.categorySource ?? null } : i)),
    );
  };

  // Ignoring marks the row reviewed on the server, so it leaves the queue. Stopping to ignore
  // leaves it reviewed (and out of the queue), so there is nothing to bring back.
  const onIgnoredChanged = (item: { id: string }, ignored: boolean) => {
    if (ignored) removeFromQueue(new Set([item.id]));
  };

  // Notes and tags don't affect review status: patch the loaded row only.
  const onNoteTagsChanged = (patch: NoteTagsPatch) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === patch.id
          ? { ...i, ...(patch.note !== undefined && { note: patch.note }), ...(patch.tags !== undefined && { tags: patch.tags }) }
          : i,
      ),
    );
  };

  const onTransferChanged = (patches: TransferPatch[]) => {
    // Linking or confirming marks both legs reviewed; unlinking does not.
    const confirmed = new Set(patches.filter((p) => p.transfer?.status === "confirmed").map((p) => p.id));
    const byId = new Map(patches.map((p) => [p.id, p.transfer]));
    const patched = new Map(
      items.filter((i) => confirmed.has(i.id)).map((i) => [i.id, { ...i, transfer: byId.get(i.id) ?? null }]),
    );
    setItems((prev) => prev.map((i) => (byId.has(i.id) && !confirmed.has(i.id) ? { ...i, transfer: byId.get(i.id) ?? null } : i)));
    const leaving = new Set(items.filter((i) => confirmed.has(i.id)).map((i) => i.id));
    if (leaving.size > 0) {
      confirmedLeave(leaving, patched);
      setDialog(null);
    }
  };

  /** Undo of a rule: the rows it categorized are uncategorized again. */
  const onRulesUndone = (ids: string[]) => {
    const cleared = new Set(ids);
    setItems((prev) => prev.map((i) => (cleared.has(i.id) ? { ...i, category: null, categorySource: null } : i)));
    router.refresh();
  };

  function openDialog(section: SheetSection | undefined) {
    if (!current) return;
    if (section === "transfer" && !showAccount) return;
    setDialog({ item: current, section });
  }

  function move(delta: number) {
    const target = items[Math.min(Math.max(index + delta, 0), items.length - 1)];
    if (target) setCurrentId(target.id);
  }

  /** Swipe left: like Next, but wrapping around so a skipped row comes back at the end. */
  function skip() {
    if (items.length < 2) return;
    setCurrentId(items[(index + 1) % items.length].id);
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    const dialogOpen = dialog !== null || helpOpen || confirmAllOpen || document.querySelector('[role="dialog"],[role="alertdialog"]') !== null;
    const action = shortcutFor(e, target, { dialogOpen });
    if (!action) return;
    e.preventDefault();
    if (action === "help") return setHelpOpen(true);
    if (action === "undo") return lastUndo.current?.();
    if (!current || busy) return;
    switch (action) {
      case "next":
        return move(1);
      case "previous":
        return move(-1);
      case "reviewed":
        return markIds([current.id]);
      case "accept":
        return acceptGuess(current);
      case "category": {
        // Focus first so closing the list returns to the category row.
        pickerRef.current?.focus();
        if (!current.split && categories.length > 0) setPickerItem(current);
        return;
      }
      case "split":
        return openDialog("split");
      case "transfer":
        return openDialog("transfer");
      case "rename":
        return openDialog("rename");
      case "toggleSelect":
        return toggle(current.id);
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const refreshMerchants = useCallback(() => router.refresh(), [router]);

  const guessButton = (
    <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={guessAll}>
      <Sparkles aria-hidden="true" className="size-4" />
      {busy ? t("guess.pending") : t("guess.button")}
    </Button>
  );

  const suggestionLine = suggestion && (
    <RuleSuggestionLine
      key={`${suggestion.matchType}:${suggestion.pattern}:${suggestion.categoryId}`}
      suggestion={suggestion}
      onCreated={onRuleCreated}
      onDismissed={() => setSuggestion(null)}
    />
  );

  const dialogs = (
    <>
      <TransactionSheet
        item={dialog?.item ?? null}
        initialSection={dialog?.section}
        categories={categories}
        merchantNames={merchantNames}
        tagNames={tagNames}
        showAccount={showAccount}
        savingsAccounts={savingsAccounts}
        onClose={() => setDialog(null)}
        queue={queue}
        onCategorized={(item, result) => onCategorized(item as ReviewQueueItem, result)}
        onCategoryRestored={restoreIntoQueue}
        onRuleCreated={onRuleCreated}
        onRulesUndone={onRulesUndone}
        onTransferChanged={onTransferChanged}
        onSplitChanged={onSplitChanged}
        onNoteTagsChanged={onNoteTagsChanged}
        onIgnoredChanged={onIgnoredChanged}
        onMerchantRenamed={refreshMerchants}
      />
      <CategoryPickerSheet
        item={pickerItem}
        itemName={pickerItem?.label ?? ""}
        categories={categories}
        onClose={() => setPickerItem(null)}
        onPick={(item, categoryId, created) => recategorize(item as ReviewQueueItem, categoryId, created)}
      />
      <NewCategorySheet
        open={bulkCreating}
        categories={categories}
        onClose={() => setBulkCreating(false)}
        onCreated={(option) => applyBulkCategory(option.id, undefined, option)}
      />
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <AlertDialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmAllTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmAllBody", { count: total })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tActions("cancel")}</AlertDialogCancel>
            <Button type="button" onClick={markAll}>
              {t("markAll")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (!current) {
    // Nothing loaded: either all done, or only rows beyond the server's cap are left.
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-4 md:px-8">
        <PageHeader
          title={t("heading", { count: total })}
          back={{ href: "/transactions", label: nav("backToTransactions") }}
        />
        {notFound}
        {total > 0 ? (
          <div className="flex flex-col items-center gap-3 pt-6 text-center md:pt-10" data-testid="review-empty">
            <span className="flex size-14 items-center justify-center rounded-full bg-positive-soft text-positive">
              <Check aria-hidden="true" className="size-8" />
            </span>
            <Button type="button" onClick={() => window.location.reload()}>
              {t("overflow.load")}
            </Button>
          {guessButton}
          </div>
        ) : (
          <EmptyState
            testId="review-empty"
            tone="positive"
            icon={Check}
            title={t("empty.title")}
            body={t("empty.body")}
            action={
              <Link href="/transactions" className={buttonVariants({ variant: "default", className: "h-11" })}>
                {t("empty.transactions")}
              </Link>
            }
            secondary={
              <Link href="/import" className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center underline underline-offset-4">
                {t("empty.import")}
              </Link>
            }
          >
          {guessButton}
          </EmptyState>
        )}
        {suggestionLine}
        {dialogs}
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-4 md:px-8">
      <PageHeader
        title={t("heading", { count: total })}
        back={{ href: "/transactions", label: nav("backToTransactions") }}
        titleTestId="review-heading"
      />
      {notFound}
      <div className="flex flex-wrap items-center gap-2">
          {guessButton}
          <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={requestMarkAll}>
            {t("markAll")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden size-11 md:inline-flex"
            aria-label={t("shortcuts.button")}
            aria-keyshortcuts="?"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp aria-hidden="true" className="size-5" />
          </Button>
      </div>

      {total > items.length && (
        <p className="text-muted-foreground text-sm">{t("overflow.message", { shown: items.length, total })}</p>
      )}

      <ReviewCard
        item={current}
        index={index}
        count={items.length}
        categories={categories}
        showAccount={showAccount}
        busy={busy}
        pickerRef={pickerRef}
        onOpenCategory={() => setPickerItem(current)}
        onReviewed={() => markIds([current.id])}
        onAccept={() => acceptGuess(current)}
        onPrevious={() => move(-1)}
        onNext={() => move(1)}
        onSkip={skip}
        onOpen={openDialog}
        onMergeDuplicate={(candidateId) => mergeDuplicate(current, candidateId)}
        onKeepBoth={() => keepBothDuplicates(current)}
      />
      {suggestionLine}

      <div className="hidden flex-col gap-4 md:flex">
        {checked.size > 0 && (
          <section aria-label={tBulk("label")} className="bg-background sticky top-0 z-10 flex flex-col gap-2 rounded-lg border p-3 shadow-sm">
            <p className="text-sm font-medium" aria-live="polite">
              {tBulk("selected", { count: checked.size })}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <Button type="button" className="h-11" disabled={busy} onClick={() => markIds([...checked])}>
                <Check aria-hidden="true" className="size-4" />
                {tBulk("markSelected", { count: checked.size })}
              </Button>
              {categories.length > 0 && (
                <>
                  <div className="flex min-w-48 flex-1 flex-col gap-1">
                    <Label htmlFor="review-bulk-category" className="sr-only">
                      {tBulk("categoryLabel")}
                    </Label>
                    <select
                      id="review-bulk-category"
                      value={bulkCategory}
                      onChange={(e) => (e.target.value === NEW_CATEGORY_VALUE ? setBulkCreating(true) : setBulkCategory(e.target.value))}
                      disabled={busy}
                      className={`${NATIVE_SELECT_CLASS} h-11`}
                    >
                      <option value="">{tBulk("chooseCategory")}</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                      <option value={NEW_CATEGORY_VALUE}>{tBulk("newCategory")}</option>
                    </select>
                  </div>
                  <Button type="button" variant="outline" className="h-11" disabled={busy || bulkCategory === ""} onClick={() => applyBulkCategory(bulkCategory)}>
                    {tBulk("apply")}
                  </Button>
                </>
              )}
              <Button type="button" variant="ghost" className="h-11" disabled={busy} onClick={() => setChecked(new Set())}>
                {tBulk("clear")}
              </Button>
            </div>
          </section>
        )}
        <ReviewList
          groups={groups}
          currentId={current.id}
          checkedIds={checked}
          busy={busy}
          onFocus={setCurrentId}
          onToggle={toggle}
          onMarkGroup={(importId) => markImport(importId)}
        />
      </div>
      {dialogs}
    </main>
  );
}
