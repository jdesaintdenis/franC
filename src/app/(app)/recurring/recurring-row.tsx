"use client";

import { Check, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, type ReactNode } from "react";

import { CategoryMarker } from "@/components/category-marker";
import { ExpectedAmount } from "@/components/expected-amount";
import { useToday } from "@/components/today-provider";
import { TransactionAvatar } from "@/components/transaction-avatar";
import { formatShortDay } from "@/lib/format-date";
import { categoryDisplayColor } from "@/lib/category-color";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { useRowSwipe } from "../transactions/use-row-swipe";
import type { RecurringViewItem } from "./view-item";

/** The item's category as a 32 px tile (its colour and icon), or the letter avatar when it has none. */
export function RecurringTile({ item }: { item: RecurringViewItem }) {
  const category = item.avatarCategory;
  if (!category) return <TransactionAvatar name={item.name} category={null} />;
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-[10px]"
      style={{
        backgroundColor: `color-mix(in srgb, ${categoryDisplayColor(category.color)} 18%, transparent)`,
      }}
    >
      <CategoryMarker
        icon={category.icon}
        color={category.color}
        className="size-4"
      />
    </span>
  );
}

/** Everything below the name: the next date, or what needs a look, then the account. */
export function RowCaption({
  item,
  showAccount,
}: {
  item: RecurringViewItem;
  showAccount: boolean;
}) {
  const locale = useLocale();
  const today = useToday();
  const t = useTranslations("recurring");
  const flagged = item.status === "confirmed" && item.possiblyCancelled;
  const interval = t(`intervals.${item.interval}`);
  let text: ReactNode;
  let warn = false;
  if (item.alert) {
    // Old price struck through, new one in amber: the rise is read at a glance.
    text = t.rich("caption.priceChange", {
      old: formatCents(Math.abs(item.alert.oldAmountCents), locale),
      new: formatCents(Math.abs(item.alert.newAmountCents), locale),
      was: (chunks) => <s className="text-muted-foreground">{chunks}</s>,
      now: (chunks) => (
        <span className="text-warning font-medium">{chunks}</span>
      ),
    });
  } else if (flagged) {
    text = t("caption.cancelled");
    warn = true;
  } else if (item.nextExpectedDate) {
    text = t("caption.next", {
      interval,
      date: formatShortDay(item.nextExpectedDate, today, locale),
    });
  } else {
    text = t("caption.last", {
      interval,
      date: formatShortDay(item.lastSeenDate, today, locale),
    });
  }
  return (
    <>
      <span className={cn(warn && "text-warning font-medium")}>{text}</span>
      {showAccount && <span> · {item.accountName}</span>}
    </>
  );
}

/**
 * One regular payment: a full-width button that opens its sheet. On touch, right confirms a
 * detected item and left dismisses a detected or confirmed one, with the action's label
 * revealed behind the row; both are undoable from the toast.
 */
export function RecurringRow({
  item,
  showAccount,
  onOpen,
  onConfirm,
  onDismiss,
  buttons = false,
}: {
  item: RecurringViewItem;
  showAccount: boolean;
  onOpen: (item: RecurringViewItem) => void;
  onConfirm: (item: RecurringViewItem) => void;
  onDismiss: (item: RecurringViewItem) => void;
  /** Adds ✕ / ✓ buttons after the amount: the "À confirmer" list, where a thumb confirms without opening the row. */
  buttons?: boolean;
}) {
  const t = useTranslations("recurring");
  const id = useId();
  const detected = item.status === "detected";
  const directions = {
    right: detected,
    left: detected || item.status === "confirmed",
  };
  const swipe = useRowSwipe({
    directions,
    // "category" is the right side and "more" the left one (see rowSwipeOutcome).
    onOutcome: (outcome) =>
      outcome === "category" ? onConfirm(item) : onDismiss(item),
  });
  const nameId = `${id}-name`;
  const captionId = `${id}-caption`;
  const amountId = `${id}-amount`;

  return (
    <li className="relative overflow-hidden">
      {swipe.offset > 0 && (
        <div
          aria-hidden="true"
          className="bg-brand text-brand-foreground absolute inset-0 flex items-center gap-2 px-5 text-sm font-semibold"
        >
          <Check className="size-4" />
          {t("swipe.confirm")}
        </div>
      )}
      {swipe.offset < 0 && (
        <div
          aria-hidden="true"
          className="bg-muted text-foreground absolute inset-0 flex items-center justify-end gap-2 px-5 text-sm font-semibold"
        >
          {t("swipe.dismiss")}
          <X className="size-4" />
        </div>
      )}
      <div
        {...swipe.handlers}
        style={{
          transform:
            swipe.offset === 0 ? undefined : `translateX(${swipe.offset}px)`,
        }}
        className={cn(
          "bg-card relative touch-pan-y",
          !swipe.dragging &&
            "transition-transform duration-200 motion-reduce:transition-none",
        )}
      >
        <div className="flex items-center">
          <button
            type="button"
            // The name and caption are the button's name; the amount is its description.
            aria-labelledby={`${nameId} ${captionId}`}
            aria-describedby={amountId}
            onClick={() => onOpen(item)}
            className="hover:bg-muted/50 focus-visible:ring-ring/50 flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
          >
            <RecurringTile item={item} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span id={nameId} className="text-sm font-medium wrap-anywhere">
                {item.name}
              </span>
              <span id={captionId} className="text-muted-foreground text-xs">
                <RowCaption item={item} showAccount={showAccount} />
              </span>
            </span>
            <span
              id={amountId}
              className={cn(
                "shrink-0 text-sm font-medium tabular-nums",
                item.typicalAmountCents > 0 && "text-positive",
              )}
            >
              <ExpectedAmount
                cents={item.typicalAmountCents}
                tracked={item.source === "manual"}
              />
            </span>
          </button>
          {buttons && (
            <span className="flex shrink-0 gap-1 pr-2">
              <button
                type="button"
                data-no-swipe
                onClick={() => onDismiss(item)}
                className="bg-secondary text-secondary-foreground focus-visible:ring-ring/50 flex size-11 items-center justify-center rounded-[10px] outline-none focus-visible:ring-[3px]"
              >
                <X className="size-4" aria-hidden="true" />
                <span className="sr-only">
                  {t("actions.dismiss")} {item.name}
                </span>
              </button>
              <button
                type="button"
                data-no-swipe
                onClick={() => onConfirm(item)}
                className="bg-primary/16 text-primary focus-visible:ring-ring/50 flex size-11 items-center justify-center rounded-[10px] outline-none focus-visible:ring-[3px]"
              >
                <Check className="size-4" aria-hidden="true" />
                <span className="sr-only">
                  {t("actions.confirm")} {item.name}
                </span>
              </button>
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
