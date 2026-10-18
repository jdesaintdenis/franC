"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { defaultRangeExtractor, useWindowVirtualizer, type Range } from "@tanstack/react-virtual";
import { Receipt, SearchX, X } from "lucide-react";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";

import { RuleSuggestionLine, type SuggestionCreated } from "@/components/rule-suggestion-line";
import { useToast } from "@/components/toast";
import { useToday } from "@/components/today-provider";
import { EmptyState } from "@/components/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import type { RuleSuggestionDetails } from "@/db/queries/guess";
import type { TransactionListItem } from "@/db/queries/transactions";
import { transactionsEmptyKind } from "@/lib/empty-state/choice";
import { formatDay } from "@/lib/format-date";
import { formatSignedCents } from "@/lib/money";
import { CATEGORY_CHANGE_FIELDS, categoryChangePatch, findCategoryRef } from "@/lib/optimistic/category";
import { patchById, revertPatches, snapshotFields } from "@/lib/optimistic/patch";
import { createSerialQueue } from "@/lib/optimistic/queue";
import type { SplitCategoryFilter } from "@/lib/splits/editor";
import { distinctTags, findTagByName, mergeTagNames, withTag } from "@/lib/tags/list";
import { MAX_TAGS_PER_TRANSACTION } from "@/lib/tags/validate";
import { activeHeaderIndex, dayHeaderIndexes, toListEntries } from "@/lib/transactions/day-groups";
import { canValidate } from "@/lib/transactions/validation";
import type { RowSwipeOutcome } from "@/lib/transactions/row-swipe";
import { cn } from "@/lib/utils";

import { bulkCategorize, categorizeTransaction, loadMoreTransactions, validateTransactionAction } from "./actions";
import { BulkBar } from "./bulk-bar";
import type { SavingsAccountOption } from "./savings-step";
import { CategoryPickerSheet } from "./category-picker-sheet";
import { useCategoryChangeToast, useMovedMessage, useMoveFailedToast } from "./category-change";
import type { CategoryOption, CategorizedResult, CategoryRestore, NoteTagsPatch, SheetSection } from "./sheet-types";
import { RowActionsSheet, type RowAction } from "./row-actions-sheet";
import { useSelectionMode } from "./selection-context";
import type { SplitPatch } from "./split-editor";
import { bulkAddTag, bulkRemoveTag } from "./tags-actions";
import { TransactionSheet } from "./transaction-sheet";
import { rowDisplayName, TransactionRow } from "./transaction-row";
import type { TransferPatch } from "./transfer-section";
import { useSwipeHint } from "./use-swipe-hint";

const ESTIMATED_ROW_HEIGHT = 72;
const ESTIMATED_HEADER_HEIGHT = 40;
// The sticky search bar (44 px field + 2 x 8 px padding): the pinned day header sits right under it.
const SEARCH_BAR_HEIGHT = "3.75rem";
// Start fetching when the viewport is this close to the end of loaded rows.
const PREFETCH_ROWS = 10;
// Mirrors the server action limit.
const MAX_BULK = 500;

interface Props {
  initialItems: TransactionListItem[];
  initialCursor: string | null;
  /** Net cents per date for the dates of `initialItems`. */
  initialDayTotals: Record<string, number>;
  /** Canonical query string; the parent keys this component on it. */
  params: string;
  hasFilters: boolean;
  categories: CategoryOption[];
  /** The user's merchant names, suggested when renaming a merchant. */
  merchantNames: string[];
  /** The user's tag names, suggested when tagging. */
  tagNames: string[];
  /** Changes when merchants change server-side: many rows were renamed, so loaded rows are replaced. */
  dataVersion: string;
  /** True when the user has several accounts. */
  showAccount: boolean;
  /** The user's Savings accounts, offered by Move to savings. */
  savingsAccounts: SavingsAccountOption[];
  /** The active category filter, so split rows can show the parts that match it. */
  categoryFilter: SplitCategoryFilter | null;
}

export function TransactionList({ initialItems, initialCursor, initialDayTotals, params, hasFilters, categories, merchantNames, tagNames, dataVersion, showAccount, savingsAccounts, categoryFilter }: Props) {
  const t = useTranslations("transactions.list");
  const locale = useLocale();
  const today = useToday();
  const tGlossary = useTranslations("common.glossary");
  const showCategoryToast = useCategoryChangeToast();
  const showMoveFailed = useMoveFailedToast();
  const movedMessage = useMovedMessage();
  const toast = useToast();
  const tToast = useTranslations("common.toast");
  const tActions = useTranslations("common.actions");
  const tBulk = useTranslations("transactions.bulk");
  const tErrors = useTranslations("transactions.errors");
  const tToastList = useTranslations("transactions.toast");
  const tTagErrors = useTranslations("transactions.tags.errors");
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [dayTotals, setDayTotals] = useState(initialDayTotals);
  const [seenVersion, setSeenVersion] = useState(dataVersion);
  if (seenVersion !== dataVersion) {
    setSeenVersion(dataVersion);
    setItems(initialItems);
    setCursor(initialCursor);
    setDayTotals(initialDayTotals);
  }
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<TransactionListItem | null>(null);
  // Which step of the sheet to open on (from the actions sheet); undefined opens the main view.
  const [sheetSection, setSheetSection] = useState<SheetSection | undefined>(undefined);
  const [pickerItem, setPickerItem] = useState<TransactionListItem | null>(null);
  const [actionsItem, setActionsItem] = useState<TransactionListItem | null>(null);
  const swipeHint = useSwipeHint();
  // Turned on by the page header's ⋯ menu or a row's actions; the checked ids are ours.
  const { selectionMode, setSelectionMode } = useSelectionMode();
  // Ids, not rows, so the selection survives virtualization and patches.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [bulkPending, startBulk] = useTransition();
  // Every category and tag save goes through one queue, so an Undo tapped while a save is on its way reaches the server after it.
  const [queue] = useState(createSerialQueue);
  // The latest rows, for saves that finish later and for "Try again".
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // Set by a hand categorization that makes a merchant qualify for a rule; shown under the toolbar.
  const [suggestion, setSuggestion] = useState<RuleSuggestionDetails | null>(null);
  // Names created here since the page loaded; merged with the server's list for suggestions.
  const [createdTagNames, setCreatedTagNames] = useState<string[]>([]);
  const suggestedTagNames = useMemo(() => mergeTagNames(tagNames, createdTagNames), [tagNames, createdTagNames]);
  const selectedTags = useMemo(
    () => distinctTags(items.filter((i) => checkedIds.has(i.id)).map((i) => i.tags)),
    [items, checkedIds],
  );

  const toggleChecked = useCallback((item: TransactionListItem) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(item.id)) next.add(item.id);
      return next;
    });
  }, []);

  function exitSelection() {
    setSelectionMode(false);
    setCheckedIds(new Set());
  }

  /** A failed save: the error toast, with Try again when retrying makes sense. */
  function saveFailedToast(message: string, retry: () => void) {
    toast.show({ message, variant: "error", action: { label: tToast("retry"), onAction: retry } });
  }

  function offlineOr(message: string) {
    return navigator.onLine === false ? tErrors("offline") : message;
  }

  /**
   * Gives rows new values at once, runs the save behind them and, if it fails, puts back exactly those
   * values (a row changed again since keeps its newer value).
   */
  function saveOptimistically<K extends keyof TransactionListItem, R extends { status: string }>(
    patches: Map<string, Pick<TransactionListItem, K>>,
    keys: readonly K[],
    save: () => Promise<R>,
    handlers: { onDone: (result: Extract<R, { status: "done" }>) => void; onFailed: (result: R | null) => void },
  ) {
    const before = snapshotFields(itemsRef.current, patches.keys(), keys);
    setItems((prev) => patchById(prev, patches));
    const revert = () => setItems((prev) => revertPatches(prev, patches, before));
    queue(save).then(
      (result) => {
        if (result.status === "done") handlers.onDone(result as Extract<R, { status: "done" }>);
        else {
          revert();
          handlers.onFailed(result);
        }
      },
      () => {
        revert();
        handlers.onFailed(null);
      },
    );
  }

  /** The rows the server may have categorized by rule, and the "Always put X in Y?" offer: both need its answer. */
  function applyConfirmed(result: CategorizedResult) {
    setSuggestion(result.ruleSuggestion ?? null);
    applyRetro(result);
  }

  function applyRetro(result: CategorizedResult) {
    const byRetroId = new Map<string, NonNullable<TransactionListItem["category"]>>();
    for (const [categoryId, ids] of Object.entries(result.retro)) {
      const category = result.retroCategories[categoryId];
      if (category) for (const id of ids) byRetroId.set(id, category);
    }
    if (byRetroId.size === 0) return;
    setItems((prev) => prev.map((i) => (byRetroId.has(i.id) ? { ...i, category: byRetroId.get(i.id) ?? null, categorySource: "rule" as const } : i)));
  }

  /** Swipe picker: the row, the toast and the picker all change now; the save follows. */
  function recategorize(item: TransactionListItem, categoryId: string | null, created?: CategoryOption) {
    const category = findCategoryRef(created ? [created] : categories, categoryId);
    const retry = () => recategorize(item, categoryId, created);
    showCategoryToast(item, movedMessage(category), onCategoryRestored, queue);
    saveOptimistically(
      new Map([[item.id, categoryChangePatch(category)]]),
      CATEGORY_CHANGE_FIELDS,
      () => categorizeTransaction({ transactionId: item.id, categoryId }),
      {
        onDone: applyConfirmed,
        onFailed: () => showMoveFailed(category?.name ?? tGlossary("uncategorized"), retry),
      },
    );
  }

  function applyBulk(categoryId: string | null, ids: string[] = [...checkedIds], created?: CategoryOption) {
    if (ids.length > MAX_BULK) {
      toast.show({ message: tBulk("tooMany", { max: MAX_BULK }), variant: "error" });
      return;
    }
    const category = findCategoryRef(created ? [created] : categories, categoryId);
    // Split rows are skipped by the server: their own category stays hidden.
    const rows = new Map(
      itemsRef.current.filter((i) => ids.includes(i.id) && !i.split).map((i) => [i.id, categoryChangePatch(category)] as const),
    );
    const skippedHere = ids.filter((id) => itemsRef.current.some((i) => i.id === id && i.split)).length;
    exitSelection();
    saveOptimistically(rows, CATEGORY_CHANGE_FIELDS, () => bulkCategorize({ transactionIds: ids, categoryId }), {
      onDone: (result) => {
        setSuggestion(result.ruleSuggestion ?? null);
        const updatedText = tBulk("updated", { count: result.updated });
        const skipped = Math.max(result.skipped, skippedHere);
        toast.show({ message: skipped > 0 ? `${updatedText} · ${tBulk("skipped", { count: skipped })}` : updatedText });
      },
      onFailed: (result) => {
        const retry = () => applyBulk(categoryId, ids, created);
        const message = result && result.status === "error" ? tErrors(result.error) : offlineOr(tErrors("saveFailed"));
        saveFailedToast(message, retry);
      },
    });
  }

  function applyAddTag(name: string, ids: string[] = [...checkedIds]) {
    if (ids.length > MAX_BULK) {
      toast.show({ message: tBulk("tooMany", { max: MAX_BULK }), variant: "error" });
      return;
    }
    const retry = () => applyAddTag(name, ids);
    const failedWith = (result: Awaited<ReturnType<typeof bulkAddTag>> | null) =>
      saveFailedToast(
        result && result.status === "error"
          ? tTagErrors(result.error, { max: MAX_TAGS_PER_TRANSACTION, length: 40 })
          : offlineOr(tErrors("saveFailed")),
        retry,
      );
    const confirmed = (result: Extract<Awaited<ReturnType<typeof bulkAddTag>>, { status: "done" }>) => {
      const { tag } = result;
      if (tag) {
        const chosen = new Set(ids);
        // Idempotent when the rows were already patched: a tag is only added once per row.
        setItems((prev) =>
          prev.map((i) => (chosen.has(i.id) && i.tags.length < MAX_TAGS_PER_TRANSACTION ? { ...i, tags: withTag(i.tags, tag) } : i)),
        );
        setCreatedTagNames((prev) => [...prev, tag.name]);
      }
      const taggedText = tBulk("tagged", { count: result.updated });
      toast.show({
        message: result.skipped > 0 ? `${taggedText} · ${tBulk("tagSkipped", { count: result.skipped, max: MAX_TAGS_PER_TRANSACTION })}` : taggedText,
      });
    };

    const known = findTagByName(itemsRef.current.map((i) => i.tags), name);
    if (known) {
      // A tag the rows already carry somewhere: show it on the chosen rows now.
      const rows = new Map(
        itemsRef.current
          .filter((i) => ids.includes(i.id) && i.tags.length < MAX_TAGS_PER_TRANSACTION)
          .map((i) => [i.id, { tags: withTag(i.tags, known) }] as const),
      );
      exitSelection();
      saveOptimistically(rows, ["tags"] as const, () => bulkAddTag({ transactionIds: ids, name }), { onDone: confirmed, onFailed: failedWith });
      return;
    }
    // A brand new tag has no id yet: wait for the server, keeping the bar disabled meanwhile.
    startBulk(async () => {
      try {
        const result = await queue(() => bulkAddTag({ transactionIds: ids, name }));
        if (result.status === "error") return failedWith(result);
        confirmed(result);
        exitSelection();
      } catch {
        failedWith(null);
      }
    });
  }

  function applyRemoveTag(tagId: string, ids: string[] = [...checkedIds]) {
    if (ids.length > MAX_BULK) {
      toast.show({ message: tBulk("tooMany", { max: MAX_BULK }), variant: "error" });
      return;
    }
    const rows = new Map(
      itemsRef.current
        .filter((i) => ids.includes(i.id))
        .map((i) => [i.id, { tags: i.tags.filter((tag) => tag.id !== tagId) }] as const),
    );
    exitSelection();
    saveOptimistically(rows, ["tags"] as const, () => bulkRemoveTag({ transactionIds: ids, tagId }), {
      onDone: (result) => toast.show({ message: tBulk("untagged", { count: result.updated }) }),
      onFailed: (result) =>
        saveFailedToast(
          result && result.status === "error"
            ? tTagErrors(result.error, { max: MAX_TAGS_PER_TRANSACTION, length: 40 })
            : offlineOr(tErrors("saveFailed")),
          () => applyRemoveTag(tagId, ids),
        ),
    });
  }

  /**
   * A row was ignored or brought back (also by Undo). It leaves or re-enters the loaded rows when the
   * "ignored" filter decides it is no longer or newly visible; the day totals follow.
   */
  function onIgnoredChanged(item: TransactionListItem, ignored: boolean) {
    const mode = new URLSearchParams(params).get("ignored");
    const visible = mode === "show" || (mode === "only" ? ignored : !ignored);
    const next = { ...item, ignored };
    if (mode !== "show") {
      setDayTotals((prev) => (item.date in prev ? { ...prev, [item.date]: prev[item.date] + (visible ? item.amountCents : -item.amountCents) } : prev));
    }
    setItems((prev) => {
      if (!visible) return prev.filter((i) => i.id !== item.id);
      if (prev.some((i) => i.id === item.id)) return prev.map((i) => (i.id === item.id ? { ...i, ignored, reviewed: next.reviewed } : i));
      // Back where it sorts (newest first); past the loaded rows it loads with the next page.
      const at = prev.findIndex((i) => i.date < item.date || (i.date === item.date && i.id < item.id));
      if (at === -1) return cursor === null ? [...prev, next] : prev;
      return [...prev.slice(0, at), next, ...prev.slice(at)];
    });
  }

  // Patch in place (no refetch) so scroll position is kept.
  const onNoteTagsChanged = useCallback((patch: NoteTagsPatch) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === patch.id
          ? { ...i, ...(patch.note !== undefined && { note: patch.note }), ...(patch.tags !== undefined && { tags: patch.tags }) }
          : i,
      ),
    );
    if (patch.tags) {
      const names = patch.tags.map((tag) => tag.name);
      setCreatedTagNames((prev) => [...prev, ...names]);
    }
  }, []);

  // The sheet reports its change at once (a result built locally), so this only patches rows.
  const onCategorized = useCallback((edited: TransactionListItem, result: CategorizedResult) => {
    setSuggestion(result.ruleSuggestion ?? null);
    const byRetroId = new Map<string, NonNullable<TransactionListItem["category"]>>();
    for (const [categoryId, ids] of Object.entries(result.retro)) {
      const category = result.retroCategories[categoryId];
      if (category) for (const id of ids) byRetroId.set(id, category);
    }
    setItems((prev) =>
      prev.map((i) => {
        if (i.id === edited.id) return { ...i, category: result.category, categorySource: result.categorySource, reviewed: result.category !== null };
        const retro = byRetroId.get(i.id);
        return retro ? { ...i, category: retro, categorySource: "rule" } : i;
      }),
    );
  }, []);

  /** A rule was created from the suggestion: loaded rows it categorized show the new category. */
  const onRuleCreated = useCallback(
    (created: SuggestionCreated) => {
      const byId = new Map<string, NonNullable<TransactionListItem["category"]>>();
      for (const [categoryId, ids] of Object.entries(created.byCategory)) {
        const option = categories.find((c) => c.id === categoryId);
        if (!option) continue;
        for (const id of ids) byId.set(id, { id: option.id, name: option.name, color: option.color, icon: option.icon, parentName: option.parentName });
      }
      if (byId.size > 0) {
        setItems((prev) => prev.map((i) => (byId.has(i.id) ? { ...i, category: byId.get(i.id) ?? null, categorySource: "rule" as const } : i)));
      }
    },
    [categories],
  );

  const onCategoryRestored = useCallback((restore: CategoryRestore) => {
    setItems((prev) =>
      prev.map((i) => (i.id === restore.id ? { ...i, category: restore.category, categorySource: restore.categorySource, reviewed: restore.reviewed } : i)),
    );
  }, []);

  /** Undo of a rule: the rows it categorized go back to uncategorized. */
  const onRulesUndone = useCallback((ids: string[]) => {
    const cleared = new Set(ids);
    setItems((prev) => prev.map((i) => (cleared.has(i.id) ? { ...i, category: null, categorySource: null } : i)));
  }, []);

  const onSplitChanged = useCallback((patch: SplitPatch) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== patch.id) return i;
        // Removing a split restores the row's own category, which the server sends back.
        return patch.split
          ? { ...i, split: patch.split }
          : { ...i, split: null, category: patch.category ?? null, categorySource: patch.categorySource ?? null };
      }),
    );
  }, []);

  // Both legs are patched when loaded; a counterpart outside the loaded pages is simply not found.
  const onTransferChanged = useCallback((patches: TransferPatch[]) => {
    const byId = new Map(patches.map((p) => [p.id, p.transfer]));
    setItems((prev) => prev.map((i) => (byId.has(i.id) ? { ...i, transfer: byId.get(i.id) ?? null } : i)));
  }, []);

  function openSheet(item: TransactionListItem, section?: SheetSection) {
    setSheetSection(section);
    setSelected(item);
  }

  /** A split row's category lives in its parts, so the sheet's split step replaces the picker. */
  function changeCategory(item: TransactionListItem) {
    if (item.split) openSheet(item, "split");
    else setPickerItem(item);
  }

  /** ✓ / swipe right: the row leaves the review queue now; "Undo" puts it back. A bare row opens the picker instead. */
  function validate(item: TransactionListItem) {
    if (!canValidate(item)) {
      changeCategory(item);
      return;
    }
    showCategoryToast(item, tToastList("validated"), onCategoryRestored, queue);
    saveOptimistically(
      new Map([[item.id, { reviewed: true, categorySource: item.categorySource === "guess" ? ("manual" as const) : item.categorySource }]]),
      ["reviewed", "categorySource"] as const,
      () => validateTransactionAction({ transactionId: item.id }),
      {
        onDone: () => {},
        onFailed: (result) => {
          if (result && "error" in result && result.error === "needsCategory") changeCategory(item);
          else toast.show({ message: offlineOr(tErrors("saveFailed")), variant: "error" });
        },
      },
    );
  }

  function onSwipe(item: TransactionListItem, outcome: Exclude<RowSwipeOutcome, null>) {
    swipeHint.dismiss();
    if (outcome === "category") validate(item);
    else setActionsItem(item);
  }

  function onRowAction(action: RowAction, item: TransactionListItem) {
    setActionsItem(null);
    if (action === "category") changeCategory(item);
    else if (action === "select") {
      setCheckedIds(new Set([item.id]));
      setSelectionMode(true);
    } else openSheet(item, action);
  }

  const entries = useMemo(() => toListEntries(items), [items]);
  const headerIndexes = useMemo(() => dayHeaderIndexes(entries), [entries]);
  // The header pinned under the search bar is always rendered, so it can stick while its day scrolls by.
  const rangeExtractor = useCallback(
    (range: Range) => {
      const active = activeHeaderIndex(headerIndexes, range.startIndex);
      const indexes = new Set(defaultRangeExtractor(range));
      if (active >= 0) indexes.add(active);
      return [...indexes].sort((a, b) => a - b);
    },
    [headerIndexes],
  );

  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // Window virtualization needs the list's distance from the top of the page.
  useLayoutEffect(() => {
    if (listRef.current) setScrollMargin(listRef.current.getBoundingClientRect().top + window.scrollY);
    // The suggestion line, the swipe tip and the selection toolbar push the list down when they appear.
  }, [suggestion, swipeHint.visible, selectionMode]);

  const virtualizer = useWindowVirtualizer({
    count: entries.length,
    estimateSize: (index) => (entries[index]?.kind === "day" ? ESTIMATED_HEADER_HEIGHT : ESTIMATED_ROW_HEIGHT),
    overscan: 8,
    scrollMargin,
    rangeExtractor,
    getItemKey: (index) => {
      const entry = entries[index];
      return entry ? (entry.kind === "day" ? `day:${entry.date}` : entry.item.id) : index;
    },
  });
  const virtualItems = virtualizer.getVirtualItems();
  const activeHeader = activeHeaderIndex(headerIndexes, virtualizer.range?.startIndex ?? 0);
  // Rows, not entries: the last entry is always a row, so this is the last loaded row's position.
  const lastIndex = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;

  const loadMore = useCallback(() => {
    if (!cursor) return;
    startTransition(async () => {
      try {
        const page = await loadMoreTransactions(params, cursor);
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
        });
        setDayTotals((prev) => ({ ...prev, ...page.dayTotals }));
        setCursor(page.nextCursor);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    });
  }, [cursor, params]);

  useEffect(() => {
    if (cursor && !isPending && !failed && lastIndex >= entries.length - PREFETCH_ROWS) loadMore();
  }, [cursor, isPending, failed, lastIndex, entries.length, loadMore]);

  if (items.length === 0) {
    const kind = transactionsEmptyKind(hasFilters);
    return kind === "noMatch" ? (
      <EmptyState
        icon={SearchX}
        title={t("empty.noMatch.title")}
        body={t("empty.noMatch.body")}
        action={
          <Link href="/transactions" className={buttonVariants({ className: "h-11" })}>
            {t("empty.noMatch.action")}
          </Link>
        }
      />
    ) : (
      <EmptyState
        icon={Receipt}
        title={t("empty.none.title")}
        body={t("empty.none.body")}
        action={
          <Link href="/import" className={buttonVariants({ className: "h-11" })}>
            {t("empty.none.action")}
          </Link>
        }
      />
    );
  }

  return (
    <div className={selectionMode ? "pb-56" : undefined}>
      {selectionMode && (
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <Button type="button" variant="default" size="sm" className="min-h-9" onClick={exitSelection}>
            {tBulk("cancel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9"
            onClick={() => setCheckedIds(new Set(items.slice(0, MAX_BULK).map((i) => i.id)))}
          >
            {tBulk("selectAll")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9"
            disabled={checkedIds.size === 0}
            onClick={() => setCheckedIds(new Set())}
          >
            {tBulk("clearSelection")}
          </Button>
        </div>
      )}
      {swipeHint.visible && !selectionMode && (
        <div className="bg-brand-soft text-brand mb-2 flex items-center gap-2 rounded-xl py-1 pr-1 pl-4 text-sm md:hidden" data-testid="swipe-hint">
          <p className="flex-1">{t("swipeHint")}</p>
          <button
            type="button"
            onClick={swipeHint.dismiss}
            aria-label={t("dismissHint")}
            className="focus-visible:ring-ring/50 flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
      {suggestion && (
        <RuleSuggestionLine
          key={`${suggestion.matchType}:${suggestion.pattern}:${suggestion.categoryId}`}
          suggestion={suggestion}
          onCreated={onRuleCreated}
          onDismissed={() => setSuggestion(null)}
          className="mb-2"
        />
      )}
      <div ref={listRef}>
      <TransactionSheet
        item={selected}
        categories={categories}
        merchantNames={merchantNames}
        tagNames={suggestedTagNames}
        showAccount={showAccount}
        savingsAccounts={savingsAccounts}
        initialSection={sheetSection}
        onClose={() => setSelected(null)}
        queue={queue}
        // The sheet shows its own rule offer, so the page-level suggestion line stays out of it.
        onCategorized={(edited, result) => onCategorized(edited, { ...result, ruleSuggestion: undefined })}
        onCategoryRestored={onCategoryRestored}
        onRuleCreated={onRuleCreated}
        onRulesUndone={onRulesUndone}
        onTransferChanged={onTransferChanged}
        onSplitChanged={onSplitChanged}
        onNoteTagsChanged={onNoteTagsChanged}
        onIgnoredChanged={onIgnoredChanged}
      />
      <CategoryPickerSheet
        item={pickerItem}
        itemName={pickerItem ? rowDisplayName(pickerItem, locale) : ""}
        categories={categories}
        onClose={() => setPickerItem(null)}
        onPick={recategorize}
      />
      <RowActionsSheet
        item={actionsItem}
        itemName={actionsItem ? rowDisplayName(actionsItem, locale) : ""}
        onClose={() => setActionsItem(null)}
        onAction={onRowAction}
      />
      <ul
        aria-label={tGlossary("transactions")}
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((v) => {
          const entry = entries[v.index];
          if (!entry) return null;
          // The active header is the one in-flow (sticky) child; every other item is placed absolutely.
          const sticky = v.index === activeHeader;
          const style: React.CSSProperties = sticky
            ? { position: "sticky", top: SEARCH_BAR_HEIGHT, zIndex: 10 }
            : { position: "absolute", top: 0, left: 0, transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` };
          if (entry.kind === "day") {
            const total = dayTotals[entry.date];
            return (
              <li
                key={v.key}
                data-index={v.index}
                data-testid="day-header"
                ref={virtualizer.measureElement}
                className={cn("flex w-full flex-col pt-3", sticky && "bg-background")}
                style={style}
              >
                {/* The date is the top of the day's note-blue card; the rows below continue it. */}
                <div className="bg-card flex items-baseline justify-between gap-3 rounded-t-xl border-b border-border/60 px-4 py-2.5">
                  <h2 className="font-title text-primary text-[13px] font-semibold tracking-[0.08em]">{formatDay(entry.date, today, locale)}</h2>
                  {total !== undefined && (
                    <span data-testid="day-total" className={cn("text-sm tabular-nums", total > 0 ? "text-positive font-medium" : "text-muted-foreground")}>
                      {formatSignedCents(total, locale)}
                    </span>
                  )}
                </div>
              </li>
            );
          }
          return (
            // No view transition here: the list is virtualized (rows are absolutely placed and
            // recycled), and a row update during one swallowed typing in the open detail sheet.
            <li key={v.key} data-index={v.index} ref={virtualizer.measureElement} className={cn("w-full", !entry.last && "border-border/60 border-b")} style={style}>
              <TransactionRow
                item={entry.item}
                showAccount={showAccount}
                onSelect={(item) => openSheet(item)}
                selectionMode={selectionMode}
                checked={checkedIds.has(entry.item.id)}
                onToggle={toggleChecked}
                categoryFilter={categoryFilter}
                onOpenActions={setActionsItem}
                onSwipe={onSwipe}
                onValidate={validate}
                last={entry.last}
              />
            </li>
          );
        })}
      </ul>
      <div className="text-muted-foreground flex min-h-12 items-center justify-center text-sm" role="status">
        {failed ? (
          <span className="flex items-center gap-2">
            {t("loadFailed")}
            <Button type="button" variant="outline" size="sm" onClick={() => { setFailed(false); loadMore(); }}>
              {t("retry")}
            </Button>
          </span>
        ) : isPending ? (
          tActions("loading")
        ) : cursor ? null : (
          t("endOfList")
        )}
      </div>
      </div>
      {selectionMode && (
        <BulkBar
          count={checkedIds.size}
          categories={categories}
          tagNames={suggestedTagNames}
          selectedTags={selectedTags}
          pending={bulkPending}
          onApply={(categoryId, created) => applyBulk(categoryId, undefined, created)}
          onAddTag={applyAddTag}
          onRemoveTag={applyRemoveTag}
        />
      )}
    </div>
  );
}
