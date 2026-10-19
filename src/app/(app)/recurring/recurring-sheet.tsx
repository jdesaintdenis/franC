"use client";

import { ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { ExpectedAmount } from "@/components/expected-amount";
import { ToastViewport } from "@/components/toast";
import { useToday } from "@/components/today-provider";
import { TransactionAvatar } from "@/components/transaction-avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatShortDay } from "@/lib/format-date";
import {
  formatCents,
  formatSignedCents,
  formatSignedPercent,
  formatSignedWholeCents,
} from "@/lib/money";
import { missedCycles } from "@/lib/recurring/missed";
import { priceIncrease } from "@/lib/recurring/price-change";
import { recentRange, TRACKED_WINDOW } from "@/lib/recurring/tracked";
import { cn } from "@/lib/utils";

import { RowCaption } from "./recurring-row";
import { CancelledPill, PriceUpPill, ToConfirmPill } from "./recurring-pills";
import { transactionsHref } from "./transactions-href";
import type { RecurringViewItem } from "./view-item";

export interface SheetActions {
  confirm: (item: RecurringViewItem) => void;
  dismiss: (item: RecurringViewItem) => void;
  end: (item: RecurringViewItem) => void;
  resume: (item: RecurringViewItem) => void;
  restore: (item: RecurringViewItem) => void;
  stillActive: (item: RecurringViewItem) => void;
  stopTracking: (item: RecurringViewItem) => void;
  setKeeps: (item: RecurringViewItem, value: boolean) => void;
  acceptPrice: (item: RecurringViewItem) => void;
  keepPrice: (item: RecurringViewItem) => void;
}

/**
 * The item sheet: what the row can't say (yearly cost, price change, last charges) and every
 * action. There are no confirm dialogs: each action closes the sheet and the toast offers Undo.
 */
export function RecurringSheet({
  item,
  showAccount,
  actions,
  onClose,
}: {
  item: RecurringViewItem | null;
  showAccount: boolean;
  actions: SheetActions;
  onClose: () => void;
}) {
  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      {item && (
        <SheetContent title={item.name} className="theme-50f min-h-[50dvh]">
          <SheetBody
            item={item}
            showAccount={showAccount}
            actions={actions}
            onClose={onClose}
          />
          <ToastViewport inSheet />
        </SheetContent>
      )}
    </Sheet>
  );
}

function SheetBody({
  item,
  showAccount,
  actions,
  onClose,
}: {
  item: RecurringViewItem;
  showAccount: boolean;
  actions: SheetActions;
  onClose: () => void;
}) {
  const locale = useLocale();
  const today = useToday();
  const t = useTranslations("recurring");
  const detected = item.status === "detected";
  const flagged = item.status === "confirmed" && item.possiblyCancelled;
  const running = detected || item.status === "confirmed";
  // Closes first so the toast appears on the page; the change itself is optimistic.
  const act = (fn: (item: RecurringViewItem) => void) => () => {
    onClose();
    fn(item);
  };
  const tracked = item.source === "manual";
  const range = tracked ? recentRange(item.history) : null;
  const alert = item.alert;
  const increase = alert
    ? priceIncrease(alert.oldAmountCents, alert.newAmountCents)
    : null;
  const missed = item.accountLatestDate
    ? missedCycles(item.lastSeenDate, item.interval, item.accountLatestDate)
    : 0;
  // The charge that raised the alert, to mark it in the history.
  const alertEntry = alert
    ? item.history.find(
        (h) =>
          h.date === alert.chargedOn && h.amountCents === alert.newAmountCents,
      )
    : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <TransactionAvatar
          name={item.name}
          category={item.avatarCategory}
          className="size-12 text-2xl"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p
            className={cn(
              "text-2xl font-bold tracking-tight tabular-nums",
              item.typicalAmountCents > 0 && "text-positive",
            )}
          >
            <ExpectedAmount cents={item.typicalAmountCents} tracked={tracked} />
          </p>
          <p className="text-muted-foreground text-sm">
            <RowCaption item={item} showAccount={false} />
          </p>
          {/* A yearly item's amount already is its yearly cost. */}
          {item.interval !== "yearly" && (
            <p className="text-muted-foreground text-sm tabular-nums">
              {t("sheet.perYear", {
                amount: formatCents(Math.abs(item.yearlyCents), locale),
              })}
            </p>
          )}
          {range && item.history.length >= 2 && (
            <p className="text-muted-foreground text-sm tabular-nums">
              {t("sheet.range", {
                count: Math.min(item.history.length, TRACKED_WINDOW),
                min: formatSignedWholeCents(range.min, locale),
                max: formatSignedWholeCents(range.max, locale),
              })}
            </p>
          )}
          {showAccount && (
            <p className="text-muted-foreground text-sm break-words">
              {item.accountName}
            </p>
          )}
        </div>
      </div>
      {(detected || item.hasPriceAlert || flagged) && (
        <div className="flex flex-wrap gap-2">
          {detected && <ToConfirmPill />}
          {item.hasPriceAlert && <PriceUpPill />}
          {flagged && <CancelledPill />}
        </div>
      )}

      {alert && increase && (
        <section
          aria-label={t("sheet.priceAlert")}
          className="bg-warning-soft flex flex-col gap-3 rounded-xl p-4 text-sm"
        >
          <p className="tabular-nums">
            {t("sheet.priceChange", {
              old: formatCents(Math.abs(alert.oldAmountCents), locale),
              new: formatCents(Math.abs(alert.newAmountCents), locale),
              diff: formatSignedCents(increase.diffCents, locale),
              percent: formatSignedPercent(increase.ratio, locale),
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="h-11"
              onClick={act(actions.acceptPrice)}
            >
              {t("sheet.acceptPrice")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={act(actions.keepPrice)}
            >
              {t("sheet.keepPrice", {
                amount: formatCents(Math.abs(alert.oldAmountCents), locale),
              })}
            </Button>
          </div>
        </section>
      )}

      {flagged && (
        <section
          aria-label={t("pills.cancelled")}
          className="bg-warning-soft flex flex-col gap-3 rounded-xl p-4 text-sm"
        >
          <p>
            {t("sheet.cancelledHint", {
              count: missed,
              last: formatShortDay(item.lastSeenDate, today, locale),
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="h-11" onClick={act(actions.end)}>
              {t("actions.end")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={act(actions.stillActive)}
            >
              {t("actions.stillActive")}
            </Button>
          </div>
        </section>
      )}

      {item.history.length > 0 && (
        <section
          aria-labelledby="history-heading"
          className="flex flex-col gap-1"
        >
          <h3 id="history-heading" className="text-sm font-semibold">
            {t("sheet.history")}
          </h3>
          <ul aria-label={t("sheet.history")} className="divide-y text-sm">
            {item.history.map((h) => (
              <li
                key={h.transactionId}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="flex flex-wrap items-center gap-2">
                  {formatShortDay(h.date, today, locale)}
                  {h === alertEntry && (
                    <span className="bg-warning-soft text-warning rounded-full px-2 py-0.5 text-xs font-medium">
                      {t("sheet.newPrice")}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "tabular-nums",
                    h.amountCents > 0 && "text-positive",
                  )}
                >
                  {formatSignedCents(h.amountCents, locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Link
        href={transactionsHref(item)}
        className="text-brand -mt-2 inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium"
      >
        {t("sheet.seeAll")}
        <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
      </Link>

      {item.status === "confirmed" && item.typicalAmountCents > 0 && (
        <label className="bg-card flex cursor-pointer flex-col gap-1 rounded-xl border p-3.5">
          <span className="flex min-h-12 items-center justify-between gap-3 font-semibold">
            <span className="flex items-center gap-2.5">
              {/* The hatched marker of "Kept for" in the Reste à vivre receipt. */}
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-[3px]"
                style={{
                  background: "repeating-linear-gradient(135deg, var(--primary) 0 2px, transparent 2px 6px)",
                  boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--primary) 60%, transparent)",
                }}
              />
              {t("sheet.keepsTitle")}
            </span>
            {/* A native checkbox drawn as a switch: keeps keyboard and test semantics. */}
            <input
              type="checkbox"
              role="switch"
              className="bg-gauge-off checked:bg-primary after:bg-foreground relative h-6 w-10 shrink-0 cursor-pointer appearance-none rounded-full transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:transition-transform checked:after:translate-x-4"
              checked={item.keepsForNextMonth}
              onChange={(e) => actions.setKeeps(item, e.target.checked)}
            />
          </span>
          <span className="text-muted-foreground text-[13px] leading-snug">
            {t(item.keepsForNextMonth ? "sheet.keepsOn" : "sheet.keepsOff")}
          </span>
        </label>
      )}

      {running && item.budget && (
        <Link
          href={item.budget.href}
          className="text-brand -mt-4 inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium"
        >
          {t(item.budget.exists ? "sheet.openBudget" : "sheet.createBudget", { category: item.budget.categoryName })}
          <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
        </Link>
      )}

      <div
        role="group"
        aria-label={t("sheet.actions")}
        className="flex flex-wrap gap-2"
      >
        {detected && (
          <Button type="button" className="h-11" onClick={act(actions.confirm)}>
            {t("actions.confirm")}
          </Button>
        )}
        {/* The callout already offers Mark ended on a flagged item. */}
        {item.status === "confirmed" && !flagged && (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={act(actions.end)}
          >
            {t("actions.end")}
          </Button>
        )}
        {running && (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={act(actions.dismiss)}
          >
            {t("actions.dismiss")}
          </Button>
        )}
        {tracked && item.status !== "dismissed" && (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={act(actions.stopTracking)}
          >
            {t("actions.stopTracking")}
          </Button>
        )}
        {item.status === "ended" && (
          <Button type="button" className="h-11" onClick={act(actions.resume)}>
            {t("actions.resume")}
          </Button>
        )}
        {item.status === "dismissed" && (
          <Button type="button" className="h-11" onClick={act(actions.restore)}>
            {t("actions.restore")}
          </Button>
        )}
      </div>
    </div>
  );
}
