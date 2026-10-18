"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { ListRowTransition } from "@/components/list-row-transition";
import { useToday } from "@/components/today-provider";
import { Button } from "@/components/ui/button";
import { formatShortDay } from "@/lib/format-date";
import { formatCents, formatSignedCents, formatWholeCents } from "@/lib/money";
import { foldedCount, type Sections } from "@/lib/recurring/sections";

import { RecurringRow, RecurringTile } from "./recurring-row";
import type { RecurringViewItem } from "./view-item";

// Confirmed lists show this many rows until "Show N more".
const FOLD = 4;
const SECTION_TITLE =
  "font-title text-primary text-xs font-semibold tracking-[0.14em] uppercase";

interface Handlers {
  showAccount: boolean;
  onOpen: (item: RecurringViewItem) => void;
  onConfirm: (item: RecurringViewItem) => void;
  onDismiss: (item: RecurringViewItem) => void;
  onResume: (item: RecurringViewItem) => void;
  onRestore: (item: RecurringViewItem) => void;
}

function RunningSection({
  id,
  title,
  aside,
  action,
  items,
  ...handlers
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  action?: ReactNode;
  items: RecurringViewItem[];
} & Handlers) {
  const t = useTranslations("recurring");
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const folded = foldedCount(items, FOLD);
  const hidden = items.length - folded;
  const shown = open ? items.length : folded;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 px-1 pt-2">
        <h2 id={id} className={SECTION_TITLE}>
          {title}
        </h2>
        {aside && (
          <p className="text-positive text-sm font-medium tabular-nums">
            {aside}
          </p>
        )}
        {action}
      </div>
      <div className="bg-card overflow-hidden rounded-lg border">
        <ul aria-label={title} className="divide-y">
          {items.slice(0, shown).map((item) => (
            <ListRowTransition key={item.id} scope="rec" id={item.id}>
              <RecurringRow
                item={item}
                showAccount={handlers.showAccount}
                onOpen={handlers.onOpen}
                onConfirm={handlers.onConfirm}
                onDismiss={handlers.onDismiss}
              />
            </ListRowTransition>
          ))}
        </ul>
        {hidden > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="text-primary hover:bg-accent/60 focus-visible:ring-ring/50 flex min-h-11 w-full items-center justify-center border-t text-sm font-semibold outline-none focus-visible:ring-[3px]"
          >
            {open
              ? t("sections.showLess")
              : t("sections.showMore", { count: hidden })}
          </button>
        )}
      </div>
    </section>
  );
}

/** A collapsed list of ended or dismissed items: what they were, and the button that brings them back. */
function ArchivedSection({
  summary,
  label,
  items,
  showAccount,
  renderDetail,
  action,
}: {
  summary: string;
  label: string;
  items: RecurringViewItem[];
  showAccount: boolean;
  renderDetail: (item: RecurringViewItem) => ReactNode;
  action: (item: RecurringViewItem) => ReactNode;
}) {
  const locale = useLocale();
  if (items.length === 0) return null;
  return (
    <details className="bg-card rounded-lg border">
      <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm font-semibold">
        {summary}
      </summary>
      <ul aria-label={label} className="divide-y border-t">
        {items.map((item) => (
          <ListRowTransition key={item.id} scope="rec-old" id={item.id}>
            <li className="flex items-start gap-3 px-4 py-3">
              <RecurringTile item={item} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium break-words">{item.name}</p>
                  <p className="text-muted-foreground shrink-0 text-sm tabular-nums">
                    {formatSignedCents(item.typicalAmountCents, locale)}
                  </p>
                </div>
                <div className="text-muted-foreground flex flex-col gap-0.5 text-xs">
                  {renderDetail(item)}
                  {showAccount && (
                    <p className="break-words">{item.accountName}</p>
                  )}
                </div>
                <div className="pt-1">{action(item)}</div>
              </div>
            </li>
          </ListRowTransition>
        ))}
      </ul>
    </details>
  );
}

/**
 * Bills and subscriptions, Income, then the collapsed Ended and Dismissed lists. The running
 * lists hold confirmed items only: detected ones wait in the "À confirmer" block.
 */
export function RecurringSections({
  sections,
  monthlyInCents,
  sortLabel,
  onSort,
  ...handlers
}: {
  sections: Sections<RecurringViewItem>;
  monthlyInCents: number;
  sortLabel: string;
  onSort: () => void;
} & Handlers) {
  const locale = useLocale();
  const today = useToday();
  const t = useTranslations("recurring");
  const sr = (name: string) => <span className="sr-only"> {name}</span>;

  return (
    <>
      <RunningSection
        id="bills-heading"
        title={t("sections.bills")}
        action={
          <button
            type="button"
            onClick={onSort}
            className="font-title text-primary -my-3 inline-flex min-h-11 items-center text-[13px] font-semibold tracking-wide"
          >
            {sortLabel}
          </button>
        }
        items={sections.bills}
        {...handlers}
      />
      <RunningSection
        id="income-heading"
        title={t("sections.income")}
        aside={
          monthlyInCents > 0
            ? t("sections.incomePerMonth", {
                amount: formatWholeCents(monthlyInCents, locale),
              })
            : undefined
        }
        items={sections.income}
        {...handlers}
      />
      <ArchivedSection
        summary={t("ended.summary", { count: sections.ended.length })}
        label={t("ended.label")}
        items={sections.ended}
        showAccount={handlers.showAccount}
        renderDetail={(item) => (
          <>
            <p>
              {item.endedAt
                ? t("ended.lastCharge", {
                    last: formatShortDay(item.lastSeenDate, today, locale),
                    ended: formatShortDay(item.endedAt, today, locale),
                  })
                : t("ended.lastChargeOnly", {
                    last: formatShortDay(item.lastSeenDate, today, locale),
                  })}
            </p>
            {item.yearlyCents < 0 && (
              <p>
                {t("ended.saving", {
                  amount: formatCents(-item.yearlyCents, locale),
                })}
              </p>
            )}
          </>
        )}
        action={(item) => (
          <Button
            type="button"
            variant="outline"
            className="h-10"
            onClick={() => handlers.onResume(item)}
          >
            {t("actions.resume")}
            {sr(item.name)}
          </Button>
        )}
      />
      <ArchivedSection
        summary={t("dismissed.summary", { count: sections.dismissed.length })}
        label={t("dismissed.label")}
        items={sections.dismissed}
        showAccount={handlers.showAccount}
        renderDetail={(item) => (
          <p>
            {t("ended.lastChargeOnly", {
              last: formatShortDay(item.lastSeenDate, today, locale),
            })}
          </p>
        )}
        action={(item) => (
          <Button
            type="button"
            variant="outline"
            className="h-10"
            onClick={() => handlers.onRestore(item)}
          >
            {t("actions.restore")}
            {sr(item.name)}
          </Button>
        )}
      />
    </>
  );
}
