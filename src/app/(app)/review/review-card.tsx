"use client";

import { ArrowLeftRight, Check, ChevronLeft, ChevronRight, Sparkles, Split, StickyNote, Tag } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { RefObject } from "react";

import { CategoryMarker } from "@/components/category-marker";
import { NoCategoriesHint } from "@/components/no-categories-hint";
import { Button } from "@/components/ui/button";
import type { ReviewQueueItem } from "@/db/queries/review";
import { CATEGORY_PATH_SEPARATOR, type CategoryOption } from "@/lib/categorize/hierarchy";
import { withIcon } from "@/lib/categorize/icon";
import { formatDay, formatShortDay } from "@/lib/format-date";
import { useToday } from "@/components/today-provider";
import { formatCents, formatSignedCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { TransferMarker } from "../transactions/transfer-marker";
import type { SheetSection } from "../transactions/sheet-types";
import { hasDestination } from "@/lib/transactions/validation";

import { useSwipe } from "./use-swipe";

interface Props {
  item: ReviewQueueItem;
  /** Zero-based position in the loaded queue. */
  index: number;
  count: number;
  categories: CategoryOption[];
  showAccount: boolean;
  busy: boolean;
  /** The category row; `C` focuses it and opens the category list. */
  pickerRef: RefObject<HTMLButtonElement | null>;
  onOpenCategory: () => void;
  onReviewed: () => void;
  /** Accepts a guessed category: manual, reviewed, and on to the next. */
  onAccept: () => void;
  onPrevious: () => void;
  onNext: () => void;
  /** Swipe left: move on without marking. */
  onSkip: () => void;
  onOpen: (section: SheetSection) => void;
  /** "Same transaction": the row is the existing candidate; the row is deleted. */
  onMergeDuplicate: (candidateId: string) => void;
  /** "Keep both": forget the candidates, keep the row. */
  onKeepBoth: () => void;
}

/** The existing rows this one may repeat, with the two ways to settle it. */
function PossibleDuplicates({
  candidates,
  busy,
  onMerge,
  onKeepBoth,
}: {
  candidates: ReviewQueueItem["possibleDuplicates"];
  busy: boolean;
  onMerge: (candidateId: string) => void;
  onKeepBoth: () => void;
}) {
  const t = useTranslations("transactions.review.card");
  const locale = useLocale();
  const today = useToday();
  return (
    <section data-testid="possible-duplicates" aria-label={t("possibleDuplicate")} className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-sm font-medium">{t("duplicatesTitle")}</p>
      <ul className="flex flex-col gap-2">
        {candidates.map((c) => {
          const date = formatShortDay(c.date, today, locale);
          const amount = formatSignedCents(c.amountCents, locale);
          return (
            <li key={c.id} data-testid="possible-duplicate-candidate" className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium break-words">{c.name}</span>
                <span className="text-muted-foreground text-xs">
                  {amount} · {date} · {c.source === "sync" ? t("fromBankShort") : t("fromCsvShort")}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy}
                aria-label={t("sameTransactionLabel", { name: c.name, amount, date })}
                onClick={() => onMerge(c.id)}
              >
                {t("sameTransaction")}
              </Button>
            </li>
          );
        })}
      </ul>
      <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={onKeepBoth}>
        {t("keepBoth")}
      </Button>
    </section>
  );
}

function DuplicateBadge() {
  const t = useTranslations("transactions.review.card");
  return (
    <span
      data-testid="possible-duplicate-badge"
      className="text-warning inline-flex w-fit items-center rounded-full border border-current px-2.5 py-0.5 text-xs font-medium"
    >
      {t("possibleDuplicate")}
    </span>
  );
}

/** Keyboard hint on the buttons; hidden on phones, where there is no keyboard. */
function Hint({ children }: { children: string }) {
  return (
    <kbd aria-hidden="true" className="border-current/30 ml-1 hidden rounded border px-1 font-mono text-xs opacity-70 md:inline">
      {children}
    </kbd>
  );
}

/**
 * Where the category came from. A guess also says so in words: the big button accepts it, so
 * this stays a note rather than a second "Accept".
 */
function CategorySourceSlot({ source }: { source: ReviewQueueItem["categorySource"] }) {
  const t = useTranslations("transactions.review.card");
  if (!source) return null;
  const text = source === "rule" ? t("fromRule") : source === "bank" ? t("fromBank") : source === "guess" ? t("fromGuess") : t("fromYou");
  return (
    <div data-slot="category-source" className="flex flex-wrap items-center gap-2">
      <span
        data-source={source}
        className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium"
      >
        {source === "guess" && <Sparkles aria-hidden="true" className="size-3" />}
        {text}
      </span>
      {source === "guess" && <span className="text-muted-foreground text-xs">{t("guessNote")}</span>}
    </div>
  );
}

export function ReviewCard({ item, index, count, categories, showAccount, busy, pickerRef, onOpenCategory, onReviewed, onAccept, onPrevious, onNext, onSkip, onOpen, onMergeDuplicate, onKeepBoth }: Props) {
  const locale = useLocale();
  const today = useToday();
  const t = useTranslations("transactions.review");
  const tCard = useTranslations("transactions.review.card");
  const tGlossary = useTranslations("common.glossary");
  const tMerchant = useTranslations("transactions.merchant");
  const tActions = useTranslations("transactions.actions");
  const guessed = item.categorySource === "guess" && !item.split;
  // Without a category, split, confirmed transfer or ignore flag the row cannot be validated: the big button picks one.
  const validatable = hasDestination(item);
  // Swiping right on a guess accepts it, like the big button.
  const { offset, dragging, handlers } = useSwipe({ onReviewed: guessed ? onAccept : validatable ? onReviewed : onOpenCategory, onSkip, disabled: busy });
  const detected = item.transfer?.status === "detected";

  return (
    <article
      aria-label={tCard("region")}
      data-testid="review-card"
      data-transaction-id={item.id}
      {...handlers}
      style={{ transform: offset !== 0 ? `translateX(${offset}px)` : undefined, touchAction: "pan-y" }}
      className={cn(
        "bg-card text-card-foreground flex flex-col gap-4 rounded-xl border p-4 shadow-sm select-none md:select-text",
        !dragging && "transition-transform motion-reduce:transition-none",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p data-testid="review-progress" className="text-muted-foreground text-sm tabular-nums" aria-live="polite">
          {t("progress", { current: index + 1, total: count })}
        </p>
        <span className="text-muted-foreground text-sm tabular-nums">{formatDay(item.date, today, locale)}</span>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg leading-snug font-semibold break-words">{item.label}</h2>
          {item.bankLabel && item.bankLabel !== item.label && (
            <p className="text-muted-foreground text-sm break-words">{tMerchant("bankLabel", { label: item.bankLabel })}</p>
          )}
          {showAccount && <p className="text-muted-foreground text-sm">{item.accountName}</p>}
          {item.transfer && <TransferMarker transfer={item.transfer} />}
          {item.possibleDuplicates.length > 0 && <DuplicateBadge />}
        </div>
        <span
          className={cn("shrink-0 text-xl font-semibold tabular-nums", item.amountCents > 0 && "text-positive")}
        >
          {formatSignedCents(item.amountCents, locale)}
        </span>
      </div>

      {item.possibleDuplicates.length > 0 && (
        <PossibleDuplicates candidates={item.possibleDuplicates} busy={busy} onMerge={onMergeDuplicate} onKeepBoth={onKeepBoth} />
      )}

      {item.split ? (
        <div className="flex flex-col gap-2" data-testid="review-split-parts">
          <p className="text-sm font-medium">{tCard("splitParts")}</p>
          <ul className="flex flex-col gap-1.5">
            {item.split.parts.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                <span className="truncate">{p.category ? withIcon(p.category.icon, p.category.name) : tGlossary("uncategorized")}</span>
                <span className="shrink-0 tabular-nums">
                  {p.amountCents < 0 ? formatCents(-p.amountCents, locale) : formatSignedCents(p.amountCents, locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <CategorySourceSlot source={item.categorySource} />
          {categories.length === 0 ? (
            <NoCategoriesHint />
          ) : (
            <>
              <button
                type="button"
                id="review-category"
                ref={pickerRef}
                disabled={busy}
                onClick={onOpenCategory}
                aria-keyshortcuts="C"
                aria-label={tCard("categoryRow", { category: item.category ? categoryText(item.category) : tGlossary("uncategorized") })}
                className="hover:bg-muted focus-visible:ring-ring/50 flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left text-base outline-none focus-visible:ring-[3px] disabled:opacity-60"
              >
                {item.category ? (
                  <CategoryMarker icon={item.category.icon} color={item.category.color} />
                ) : (
                  <span aria-hidden="true" className="text-muted-foreground size-3 shrink-0 rounded-full" style={{ boxShadow: "inset 0 0 0 1px currentColor" }} />
                )}
                <span className="min-w-0 flex-1 font-medium break-words">{item.category ? categoryText(item.category) : tGlossary("uncategorized")}</span>
                <Hint>C</Hint>
                <ChevronRight aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
              </button>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!item.transfer && item.amountCents !== 0 && (
          <Button type="button" variant="outline" className="h-11 flex-1" disabled={busy} onClick={() => onOpen("split")} aria-keyshortcuts="S">
            <Split aria-hidden="true" className="size-4" />
            {item.split ? tCard("editSplit") : tCard("split")}
            <Hint>S</Hint>
          </Button>
        )}
        {showAccount && (
          <Button type="button" variant="outline" className="h-11 flex-1" disabled={busy} onClick={() => onOpen("transfer")} aria-keyshortcuts="T">
            <ArrowLeftRight aria-hidden="true" className="size-4" />
            {detected ? tCard("confirmTransfer") : tCard("transfer")}
            <Hint>T</Hint>
          </Button>
        )}
        <Button type="button" variant="outline" className="h-11 flex-1" disabled={busy} onClick={() => onOpen("note")}>
          <StickyNote aria-hidden="true" className="size-4" />
          {tActions("noteTags")}
        </Button>
        <Button type="button" variant="outline" className="h-11 flex-1" disabled={busy} onClick={() => onOpen("rename")} aria-keyshortcuts="N">
          <Tag aria-hidden="true" className="size-4" />
          {tCard("rename")}
          <Hint>N</Hint>
        </Button>
      </div>

      {guessed ? (
        <Button type="button" className="h-14 w-full text-base" disabled={busy} onClick={onAccept} aria-keyshortcuts="A">
          <Check aria-hidden="true" className="size-5" />
          {tCard("accept")}
          <Hint>A</Hint>
        </Button>
      ) : !validatable ? (
        <Button type="button" className="h-14 w-full text-base" disabled={busy} onClick={onOpenCategory} data-testid="review-choose-category">
          {tCard("chooseCategory")}
        </Button>
      ) : (
        <Button type="button" className="h-14 w-full text-base" disabled={busy} onClick={onReviewed} aria-keyshortcuts="R">
          <Check aria-hidden="true" className="size-5" />
          {tCard("reviewed")}
          <Hint>R</Hint>
        </Button>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-11 flex-1" disabled={index === 0} onClick={onPrevious} aria-keyshortcuts="K">
          <ChevronLeft aria-hidden="true" className="size-4" />
          {tCard("previous")}
        </Button>
        <Button type="button" variant="outline" className="h-11 flex-1" disabled={index >= count - 1} onClick={onNext} aria-keyshortcuts="J">
          {tCard("next")}
          <ChevronRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <p className="text-muted-foreground text-center text-xs md:hidden">{t("swipeHint")}</p>
    </article>
  );
}

/** Category label used in the queue list. */
export function categoryText(category: NonNullable<ReviewQueueItem["category"]>): string {
  return category.parentName ? `${category.parentName}${CATEGORY_PATH_SEPARATOR}${category.name}` : category.name;
}
