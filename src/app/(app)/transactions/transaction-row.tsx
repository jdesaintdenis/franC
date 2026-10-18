import { Check, CircleCheck, MoreHorizontal, Sparkles, Split, StickyNote, Tag } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { TransactionAvatar } from "@/components/transaction-avatar";
import type { TransactionListItem } from "@/db/queries/transactions";
import type { Locale } from "@/i18n/config";
import { withIcon } from "@/lib/categorize/icon";
import { matchingSplitParts, type SplitCategoryFilter } from "@/lib/splits/editor";
import { formatCents, formatSignedCents } from "@/lib/money";
import type { RowSwipeOutcome } from "@/lib/transactions/row-swipe";
import { canValidate } from "@/lib/transactions/validation";
import { toDisplayCase } from "@/lib/transactions/display-case";
import { cn } from "@/lib/utils";

import { TransferMarker } from "./transfer-marker";
import { useRowSwipe } from "./use-row-swipe";

interface Props {
  item: TransactionListItem;
  showAccount?: boolean;
  onSelect: (item: TransactionListItem) => void;
  /** In selection mode the row toggles instead of opening the dialog, and never swipes. */
  selectionMode?: boolean;
  checked?: boolean;
  onToggle?: (item: TransactionListItem) => void;
  /** Active category filter: a split row shows the parts that match it. */
  categoryFilter?: SplitCategoryFilter | null;
  /** The ⋯ button: opens the actions sheet. */
  onOpenActions: (item: TransactionListItem) => void;
  /** The ✓ button: validates a row that already says where its money went. */
  onValidate: (item: TransactionListItem) => void;
  /** Last row of the day card, for the rounded bottom corners. */
  last?: boolean;
  /** A finished swipe: right = validate (or pick a category), left = more actions. */
  onSwipe: (item: TransactionListItem, outcome: Exclude<RowSwipeOutcome, null>) => void;
}

/** Chips shown on a row before "+N"; the dialog lists them all. */
const ROW_TAG_CHIPS = 2;

/** What the row calls itself: the merchant name as saved, else the bank label in display case. */
export function rowDisplayName(item: Pick<TransactionListItem, "label" | "merchant">, locale: Locale): string {
  return item.merchant ? item.label : toDisplayCase(item.label, locale);
}

export function TransactionRow({
  item,
  showAccount = false,
  onSelect,
  selectionMode = false,
  checked = false,
  onToggle,
  categoryFilter = null,
  onOpenActions,
  onSwipe,
  onValidate,
  last = false,
}: Props) {
  const locale = useLocale();
  const t = useTranslations("transactions.row");
  const tGlossary = useTranslations("common.glossary");
  const swipe = useRowSwipe({ disabled: selectionMode, onOutcome: (outcome) => onSwipe(item, outcome) });
  const name = rowDisplayName(item, locale);
  const validatable = canValidate(item);
  const toReview = !item.reviewed && !item.ignored;
  const matched = item.split ? matchingSplitParts(item.split.parts, categoryFilter) : [];
  // While split, item.category is a hidden stale value: only the parts count.
  const splitNames = item.split
    ? [
        ...new Set(
          item.split.parts.map((p) => (p.category ? withIcon(p.category.icon, p.category.name) : tGlossary("uncategorized"))),
        ),
      ].join(", ")
    : "";
  const noteLine = item.note ? item.note.split("\n")[0] : null;
  const shownTags = item.tags.slice(0, ROW_TAG_CHIPS);
  const hiddenTags = item.tags.length - shownTags.length;
  const accountSuffix = showAccount ? <span className="shrink-0"> · {item.accountName}</span> : null;

  return (
    <div className={cn("relative overflow-hidden", last && "rounded-b-xl")}>
      {swipe.offset > 0 && (
        <div aria-hidden="true" className="bg-brand text-brand-foreground absolute inset-0 flex items-center justify-start px-5 text-sm font-semibold">
          {validatable ? t("swipeValidate") : t("swipeCategory")}
        </div>
      )}
      {swipe.offset < 0 && (
        <div aria-hidden="true" className="bg-muted text-muted-foreground absolute inset-0 flex items-center justify-end px-5 text-sm font-semibold">
          {t("swipeMore")}
        </div>
      )}
      <div
        {...swipe.handlers}
        style={{ transform: swipe.offset === 0 ? undefined : `translateX(${swipe.offset}px)` }}
        className={cn(
          "bg-card relative flex touch-pan-y items-center",
          !swipe.dragging && "transition-transform duration-200 motion-reduce:transition-none",
          checked && "bg-muted",
        )}
      >
        <button
          type="button"
          role={selectionMode ? "checkbox" : undefined}
          aria-checked={selectionMode ? checked : undefined}
          onClick={() => (selectionMode ? onToggle?.(item) : onSelect(item))}
          className="hover:bg-muted/50 active:bg-muted focus-visible:ring-ring/50 flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3 px-1 py-2 text-left outline-none focus-visible:ring-[3px]"
        >
          {selectionMode && (
            <span
              aria-hidden="true"
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-sm border",
                checked ? "bg-primary border-primary text-primary-foreground" : "border-input",
              )}
            >
              {checked && <Check className="size-3.5" />}
            </span>
          )}
          <span className="relative shrink-0">
            <TransactionAvatar name={name} category={item.category} split={item.split !== null} transfer={item.transfer !== null} />
            {/* Like a bank app: a filled ✓ once validated, an empty amber ring while it waits. Ignored rows get neither. */}
            {!item.ignored && (
              <span
                aria-hidden="true"
                data-testid={toReview ? "row-to-review" : "row-validated"}
                className={cn(
                  "ring-card absolute -bottom-0.5 -left-0.5 flex size-4 items-center justify-center rounded-full ring-2",
                  toReview ? "bg-card border-warning border-2" : "bg-positive text-card",
                )}
              >
                {!toReview && <Check className="size-3" strokeWidth={3} />}
              </span>
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="sr-only">{selectionMode ? t("select") : t("categorize")}</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium">{name}</span>
              {toReview && <span className="sr-only">{t("toReview")}</span>}
              {item.ignored && (
                <span data-testid="row-ignored" className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs">
                  {t("ignored")}
                </span>
              )}
            </span>
            {item.transfer ? (
              <span className="text-muted-foreground flex min-w-0 items-center text-xs">
                <TransferMarker transfer={item.transfer} />
                {accountSuffix}
              </span>
            ) : item.split ? (
              <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs" data-testid="split-chip">
                <Split aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{t("split", { names: splitNames })}</span>
                {accountSuffix}
              </span>
            ) : (
              <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
                {item.category && item.categorySource === "guess" && <Sparkles aria-hidden="true" className="size-3 shrink-0" />}
                {item.category && item.categorySource === "guess" && <span className="sr-only">{t("guessed")}</span>}
                {item.category && item.categorySource === "bank" && <span className="sr-only">{t("fromBank")}</span>}
                <span className={cn("truncate", item.categorySource === "guess" && "italic", !item.category && "text-warning")}>
                  {item.category ? item.category.name : tGlossary("uncategorized")}
                </span>
                {accountSuffix}
              </span>
            )}
            {noteLine && (
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs" data-testid="row-note">
                <StickyNote aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="sr-only">{t("note")}</span>
                <span className="truncate">{noteLine}</span>
              </span>
            )}
            {shownTags.length > 0 && (
              <span className="flex items-center gap-1" data-testid="row-tags">
                <span className="sr-only">{t("tags")}</span>
                {shownTags.map((tag) => (
                  <span key={tag.id} className="bg-muted text-muted-foreground inline-flex min-w-0 max-w-28 items-center gap-1 rounded-full px-2 py-0.5 text-xs">
                    <Tag aria-hidden="true" className="size-3 shrink-0" />
                    <span className="truncate">{tag.name}</span>
                  </span>
                ))}
                {hiddenTags > 0 && <span className="text-muted-foreground shrink-0 text-xs">{t("moreTags", { count: hiddenTags })}</span>}
              </span>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={cn("text-sm font-medium tabular-nums", item.amountCents > 0 && "text-positive")}>
              {formatSignedCents(item.amountCents, locale)}
            </span>
            {matched.map((p) => (
              <span key={p.id} className="text-muted-foreground max-w-40 truncate text-xs tabular-nums">
                {p.category ? withIcon(p.category.icon, p.category.name) : tGlossary("uncategorized")}: {(p.amountCents < 0 ? formatCents(-p.amountCents, locale) : formatSignedCents(p.amountCents, locale))}
              </span>
            ))}
          </div>
        </button>
        {/* Rows that cannot be validated keep the ✓ slot empty so every amount lines up. */}
        {!selectionMode && !validatable && <span aria-hidden="true" className="size-11 shrink-0" />}
        {!selectionMode && validatable && (
          <button
            type="button"
            data-no-swipe=""
            data-testid="row-validate"
            aria-label={t("validate", { name })}
            onClick={() => onValidate(item)}
            className="text-primary hover:bg-muted focus-visible:ring-ring/50 flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]"
          >
            <CircleCheck className="size-6" aria-hidden="true" />
          </button>
        )}
        {!selectionMode && (
          // A sibling of the row button, never inside it: no nested interactive elements. From md it
          // sits at the row's end; on phones it only appears while focused (swipe is the touch way).
          <button
            type="button"
            data-no-swipe=""
            data-testid="row-more"
            aria-label={t("moreActions", { name })}
            onClick={() => onOpenActions(item)}
            className={cn(
              "hover:bg-muted text-muted-foreground focus-visible:ring-ring/50 flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]",
              "max-md:bg-muted max-md:pointer-events-none max-md:absolute max-md:right-1 max-md:opacity-0 max-md:focus-visible:pointer-events-auto max-md:focus-visible:opacity-100",
            )}
          >
            <MoreHorizontal className="size-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
