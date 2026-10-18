"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import { useToast } from "@/components/toast";
import { useToday } from "@/components/today-provider";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { LinkCandidate } from "@/db/queries/manual-transactions";
import type { TransactionListItem } from "@/db/queries/transactions";
import { formatDay } from "@/lib/format-date";
import { formatSignedCents } from "@/lib/money";

import {
  deleteManualTransactionAction,
  linkManualToBankRowAction,
  listLinkCandidatesAction,
  restoreManualTransactionAction,
  setManualWaitingAction,
} from "../transactions/manual-actions";

/**
 * "Not found in your bank" (Slice 56): rows added by hand that the bank still hasn't shown a week later. Each one
 * can be kept as it is, deleted, or linked to the bank row it turned out to be.
 */
export function NotFoundList({ items, showAccount }: { items: TransactionListItem[]; showAccount: boolean }) {
  const t = useTranslations("transactions.review.notFound");
  const locale = useLocale();
  const today = useToday();
  const toast = useToast();
  // Rows handled here leave at once; the server's list catches up on its own refresh.
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [linking, setLinking] = useState<TransactionListItem | null>(null);
  const [, startTransition] = useTransition();
  const visible = items.filter((i) => !gone.has(i.id));
  if (visible.length === 0) return null;

  const hide = (id: string, hidden: boolean) =>
    setGone((prev) => {
      const next = new Set(prev);
      if (hidden) next.add(id);
      else next.delete(id);
      return next;
    });

  function keep(item: TransactionListItem) {
    startTransition(async () => {
      try {
        const result = await setManualWaitingAction({ id: item.id, waiting: false });
        if (result.status === "error") throw new Error("keep");
      } catch {
        toast.show({ message: t("failed"), variant: "error" });
        return;
      }
      hide(item.id, true);
      toast.show({
        message: t("kept"),
        undo: {
          onUndo: async () => {
            try {
              const result = await setManualWaitingAction({ id: item.id, waiting: true });
              if (result.status === "done") hide(item.id, false);
            } catch {
              toast.show({ message: t("failed"), variant: "error" });
            }
          },
        },
      });
    });
  }

  function remove(item: TransactionListItem) {
    startTransition(async () => {
      let snapshot;
      try {
        const result = await deleteManualTransactionAction({ id: item.id });
        if (result.status === "error") throw new Error("delete");
        snapshot = result.snapshot;
      } catch {
        toast.show({ message: t("failed"), variant: "error" });
        return;
      }
      hide(item.id, true);
      toast.show({
        message: t("deleted"),
        undo: {
          onUndo: async () => {
            try {
              // The row comes back with a new id: the server's refreshed list shows it again.
              await restoreManualTransactionAction(snapshot);
            } catch {
              toast.show({ message: t("failed"), variant: "error" });
            }
          },
        },
      });
    });
  }

  return (
    <section aria-labelledby="not-found-heading" data-testid="not-found" className="bg-card flex flex-col gap-2 rounded-2xl border p-4">
      <h2 id="not-found-heading" className="text-base font-semibold">
        {t("heading", { count: visible.length })}
      </h2>
      <p className="text-muted-foreground text-sm">{t("hint")}</p>
      <ul className="divide-y">
        {visible.map((item) => (
          <li key={item.id} data-testid="not-found-item" className="flex flex-col gap-2 py-3">
            <div className="flex items-baseline gap-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{item.shortLabel}</span>
                <span className="text-muted-foreground text-sm">
                  {[formatDay(item.date, today, locale), showAccount ? item.accountName : null].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="font-medium tabular-nums">{formatSignedCents(item.amountCents, locale)}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-11" data-testid="not-found-keep" onClick={() => keep(item)}>
                {t("keep")}
              </Button>
              <Button type="button" variant="outline" className="h-11" data-testid="not-found-link" onClick={() => setLinking(item)}>
                {t("link")}
              </Button>
              <Button type="button" variant="ghost" className="h-11" data-testid="not-found-delete" onClick={() => remove(item)}>
                {t("delete")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Sheet open={linking !== null} onOpenChange={(open) => !open && setLinking(null)}>
        {linking && (
          <LinkSheetBody
            key={linking.id}
            item={linking}
            onLinked={() => {
              hide(linking.id, true);
              setLinking(null);
              toast.show({ message: t("linked") });
            }}
          />
        )}
      </Sheet>
    </section>
  );
}

function LinkSheetBody({ item, onLinked }: { item: TransactionListItem; onLinked: () => void }) {
  const t = useTranslations("transactions.review.notFound");
  const locale = useLocale();
  const today = useToday();
  const [candidates, setCandidates] = useState<LinkCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    listLinkCandidatesAction({ id: item.id })
      .then((result) => {
        if (!cancelled) setCandidates(result.status === "done" ? result.candidates : []);
      })
      .catch(() => {
        if (cancelled) return;
        setCandidates([]);
        setError(t("failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, t]);

  function link(candidate: LinkCandidate) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await linkManualToBankRowAction({ manualId: item.id, bankRowId: candidate.id });
        if (result.status === "error") {
          setError(t("failed"));
          return;
        }
        onLinked();
      } catch {
        setError(t("failed"));
      }
    });
  }

  return (
    <SheetContent title={t("linkTitle")} description={item.split ? t("linkSplit") : undefined}>
      {candidates === null ? (
        <p className="text-muted-foreground text-sm">…</p>
      ) : candidates.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noCandidates")}</p>
      ) : (
        <ul className="-mx-3 flex flex-col">
          {candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                data-testid="not-found-candidate"
                disabled={pending}
                onClick={() => link(c)}
                className="hover:bg-muted focus-visible:ring-ring/50 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left outline-none focus-visible:ring-[3px] disabled:opacity-60"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{c.label}</span>
                  <span className="text-muted-foreground text-sm">{formatDay(c.date, today, locale)}</span>
                </span>
                <span className="font-medium tabular-nums">{formatSignedCents(c.amountCents, locale)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </SheetContent>
  );
}
