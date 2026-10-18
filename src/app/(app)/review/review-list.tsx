"use client";

import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { NATIVE_CHECKBOX_CLASS } from "@/components/ui/native-select";
import type { ReviewQueueItem } from "@/db/queries/review";
import { formatDateTime } from "@/lib/format-date";
import { formatSignedCents } from "@/lib/money";
import type { ReviewGroup } from "@/lib/review/group";
import { cn } from "@/lib/utils";

import { categoryText } from "./review-card";

interface Props {
  groups: ReviewGroup<ReviewQueueItem>[];
  currentId: string | null;
  checkedIds: ReadonlySet<string>;
  busy: boolean;
  onFocus: (id: string) => void;
  onToggle: (id: string) => void;
  onMarkGroup: (importId: string, count: number) => void;
}

/** The queue as a list grouped by import (md and up; the phone shows one card at a time). */
export function ReviewList({ groups, currentId, checkedIds, busy, onFocus, onToggle, onMarkGroup }: Props) {
  const locale = useLocale();
  const t = useTranslations("transactions.review.list");
  const tGlossary = useTranslations("common.glossary");
  const tCard = useTranslations("transactions.review.card");
  const tRow = useTranslations("transactions.row");

  return (
    <div aria-label={t("label")} role="group" className="flex flex-col gap-4">
      {groups.map((group) => {
        const title = group.kind === "sync" ? t("syncedFrom", { bank: group.filename }) : group.filename;
        return (
        <section key={group.importId} aria-label={t("groupLabel", { filename: title })} className="flex flex-col rounded-lg border">
          <header className="flex items-center justify-between gap-3 border-b px-3 py-2">
            <div className="flex min-w-0 flex-col">
              <h3 className="truncate text-sm font-medium">{title}</h3>
              <p className="text-muted-foreground truncate text-xs">
                {t("groupMeta", { account: group.accountName, date: formatDateTime(new Date(group.uploadedAt), locale) })}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-9 shrink-0"
              disabled={busy}
              onClick={() => onMarkGroup(group.importId, group.items.length)}
            >
              {t("markGroup", { count: group.items.length })}
            </Button>
          </header>
          <ul>
            {group.items.map((item) => {
              const current = item.id === currentId;
              return (
                <li key={item.id} className={cn("flex items-center gap-2 border-b px-3 last:border-b-0", current && "bg-muted")}>
                  <input
                    type="checkbox"
                    checked={checkedIds.has(item.id)}
                    onChange={() => onToggle(item.id)}
                    aria-label={t("select", { label: item.label })}
                    className={`${NATIVE_CHECKBOX_CLASS} size-5 shrink-0`}
                  />
                  <button
                    type="button"
                    onClick={() => onFocus(item.id)}
                    aria-current={current ? "true" : undefined}
                    aria-label={t("focus", { label: item.label })}
                    className="focus-visible:ring-ring/50 flex min-h-12 min-w-0 flex-1 items-center justify-between gap-3 py-2 text-left outline-none focus-visible:ring-[3px]"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{item.label}</span>
                      {item.possibleDuplicates.length > 0 && (
                        <span data-testid="possible-duplicate-badge" className="text-warning w-fit text-xs font-medium">
                          {tCard("possibleDuplicate")}
                        </span>
                      )}
                      <span className="text-muted-foreground truncate text-xs">
                        {item.split
                          ? tRow("split", {
                              names: [...new Set(item.split.parts.map((p) => (p.category ? p.category.name : tGlossary("uncategorized"))))].join(", "),
                            })
                          : item.category ? categoryText(item.category) : tGlossary("uncategorized")}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">{formatSignedCents(item.amountCents, locale)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        );
      })}
    </div>
  );
}
