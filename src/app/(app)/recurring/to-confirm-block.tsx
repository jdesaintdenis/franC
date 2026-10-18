"use client";

import { Check, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";

import { ExpectedAmount } from "@/components/expected-amount";
import { formatShortMonthLabel } from "@/lib/dashboard/month";
import { formatWholeCents } from "@/lib/money";
import { yearlyCents } from "@/lib/recurring/yearly";
import { cn } from "@/lib/utils";

import { useRowSwipe } from "../transactions/use-row-swipe";
import { RecurringRow, RecurringTile, RowCaption } from "./recurring-row";
import type { RecurringViewItem } from "./view-item";

const VIEW_KEY = "franc:recurring-to-confirm-view";
const LIST_PREVIEW = 5;

type Mode = "card" | "list";

// Which of the two views the block shows is a per-device habit, kept in localStorage.
const listeners = new Set<() => void>();
let remembered: Mode | null = null;

function readMode(): Mode {
  if (remembered) return remembered;
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "card";
  } catch {
    return "card";
  }
}

function writeMode(mode: Mode) {
  remembered = mode;
  try {
    localStorage.setItem(VIEW_KEY, mode);
  } catch {
    // Private mode or blocked storage: the in-memory choice is enough.
  }
  listeners.forEach((listener) => listener());
}

function useMode(): [Mode, (mode: Mode) => void] {
  const mode = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readMode,
    () => "card" as Mode,
  );
  return [mode, writeMode];
}

interface Props {
  /** Detected items in the order the block shows them. */
  items: RecurringViewItem[];
  /** What they cost per month in all (outflows). */
  monthlyCents: number;
  showAccount: boolean;
  onOpen: (item: RecurringViewItem) => void;
  onConfirm: (item: RecurringViewItem) => void;
  onDismiss: (item: RecurringViewItem) => void;
  onConfirmAll: () => void;
}

/**
 * The payments found automatically, waiting for a yes or a no: one at a time as a card (a thumb
 * decides in a second), or all together as a list with ✓ / ✕ on every row. Gone once nothing is left.
 */
export function ToConfirmBlock(props: Props) {
  const t = useTranslations("recurring");
  const locale = useLocale();
  const [mode, setMode] = useMode();
  const { items } = props;
  if (items.length === 0) return null;

  const amount = formatWholeCents(props.monthlyCents, locale);
  const linkClass =
    "font-title text-primary -my-3 inline-flex min-h-11 items-center text-[13px] font-semibold tracking-wide";

  return (
    <section
      aria-labelledby="to-confirm-heading"
      data-testid="to-confirm"
      className="flex flex-col gap-2"
    >
      <div className="flex items-baseline justify-between gap-3 px-1 pt-2">
        <h2
          id="to-confirm-heading"
          className="font-title text-primary text-xs font-semibold tracking-[0.14em] uppercase"
        >
          {t("pills.toConfirm")}
        </h2>
        <button
          type="button"
          onClick={() => setMode(mode === "card" ? "list" : "card")}
          className={linkClass}
        >
          {mode === "card" ? t("toConfirm.showList") : t("toConfirm.oneByOne")}
        </button>
      </div>
      <div className="bg-card border-warning/45 overflow-hidden rounded-lg border">
        {mode === "card" ? (
          <>
            <p className="text-muted-foreground px-3.5 pt-3 text-xs tabular-nums">
              {t("toConfirm.counter", {
                index: 1,
                count: items.length,
                amount,
              })}
            </p>
            <ConfirmCard key={items[0].id} item={items[0]} {...props} />
          </>
        ) : (
          <ConfirmList {...props} />
        )}
      </div>
    </section>
  );
}

function ConfirmCard({
  item,
  showAccount,
  onOpen,
  onConfirm,
  onDismiss,
}: Props & { item: RecurringViewItem }) {
  const t = useTranslations("recurring");
  const locale = useLocale();
  const swipe = useRowSwipe({
    directions: { right: true, left: true },
    // "category" is the right side and "more" the left one (see rowSwipeOutcome).
    onOutcome: (outcome) =>
      outcome === "category" ? onConfirm(item) : onDismiss(item),
  });
  const yearly = formatWholeCents(
    Math.abs(yearlyCents(item.typicalAmountCents, item.interval)),
    locale,
  );
  const recent = item.history.slice(0, 4).reverse();

  return (
    <div className="flex flex-col gap-3 p-3.5">
      <div
        {...swipe.handlers}
        style={{
          transform:
            swipe.offset === 0 ? undefined : `translateX(${swipe.offset}px)`,
        }}
        className={cn(
          "touch-pan-y",
          !swipe.dragging &&
            "transition-transform duration-200 motion-reduce:transition-none",
        )}
      >
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="focus-visible:ring-ring/50 flex w-full flex-col gap-3 rounded-md text-left outline-none focus-visible:ring-[3px]"
        >
          <span className="flex items-center gap-2.5">
            <RecurringTile item={item} />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-semibold wrap-anywhere">
                {item.name}
              </span>
              <span className="text-muted-foreground text-xs">
                <RowCaption item={item} showAccount={showAccount} />
              </span>
            </span>
          </span>
          <span className="flex flex-col">
            <span className="text-[28px] leading-none font-extrabold tabular-nums">
              <ExpectedAmount
                cents={item.typicalAmountCents}
                tracked={item.source === "manual"}
              />
            </span>
            <span className="text-muted-foreground text-xs">
              {item.interval === "monthly"
                ? t("toConfirm.perYear", { amount: yearly })
                : t("toConfirm.perYearOther", {
                    interval: t(`intervals.${item.interval}`),
                    amount: yearly,
                  })}
            </span>
          </span>
          {recent.length > 0 && (
            <span
              className="flex gap-1.5"
              role="group"
              aria-label={t("toConfirm.history")}
            >
              {recent.map((entry) => (
                <span
                  key={entry.transactionId}
                  className="bg-secondary flex flex-1 flex-col rounded-md px-2 py-1 tabular-nums"
                >
                  <span className="text-xs font-semibold">
                    {formatWholeCents(Math.abs(entry.amountCents), locale)}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    {formatShortMonthLabel(entry.date.slice(0, 7), locale)}
                  </span>
                </span>
              ))}
            </span>
          )}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onDismiss(item)}
          className="bg-secondary text-secondary-foreground focus-visible:ring-ring/50 flex min-h-[52px] items-center justify-center gap-2 rounded-xl font-bold outline-none focus-visible:ring-[3px]"
        >
          <X className="size-4" aria-hidden="true" />
          {t("actions.dismiss")}
          <span className="sr-only"> {item.name}</span>
        </button>
        <button
          type="button"
          onClick={() => onConfirm(item)}
          className="bg-primary text-primary-foreground focus-visible:ring-ring/50 flex min-h-[52px] items-center justify-center gap-2 rounded-xl font-bold outline-none focus-visible:ring-[3px]"
        >
          <Check className="size-4" aria-hidden="true" />
          {t("actions.confirm")}
          <span className="sr-only"> {item.name}</span>
        </button>
      </div>
    </div>
  );
}

function ConfirmList({
  items,
  showAccount,
  onOpen,
  onConfirm,
  onDismiss,
  onConfirmAll,
}: Props) {
  const t = useTranslations("recurring");
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, LIST_PREVIEW);

  return (
    <>
      <div className="flex flex-col gap-0.5 px-3.5 pt-3">
        <p className="text-sm font-semibold">
          {t("toConfirm.found", { count: items.length })}
        </p>
        <p className="text-muted-foreground text-xs">
          {t("toConfirm.question")}
        </p>
      </div>
      <ul
        aria-label={t("toConfirm.listLabel")}
        className="divide-border mt-1 divide-y"
      >
        {shown.map((item) => (
          <RecurringRow
            key={item.id}
            item={item}
            showAccount={showAccount}
            onOpen={onOpen}
            onConfirm={onConfirm}
            onDismiss={onDismiss}
            buttons
          />
        ))}
      </ul>
      {items.length > LIST_PREVIEW && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-primary hover:bg-accent/60 focus-visible:ring-ring/50 flex min-h-11 w-full items-center justify-center border-t text-sm font-semibold outline-none focus-visible:ring-[3px]"
        >
          {t("toConfirm.showMore", { count: items.length - LIST_PREVIEW })}
        </button>
      )}
      <div className="border-t p-3">
        <button
          type="button"
          onClick={onConfirmAll}
          className="bg-primary text-primary-foreground focus-visible:ring-ring/50 flex min-h-12 w-full items-center justify-center rounded-xl font-bold outline-none focus-visible:ring-[3px]"
        >
          {t("band.confirmAll")}
        </button>
      </div>
    </>
  );
}
