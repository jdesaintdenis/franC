"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { RowMenu } from "@/components/manage/row-menu";
import { useToday } from "@/components/today-provider";
import type { ImportListItem } from "@/db/queries/imports";
import { formatShortInstantTime } from "@/lib/format-date";

import { HomeSection } from "../home/home-section";
import { UndoImportDialog } from "./undo-import-dialog";

export function ImportHistory({ imports, showAccount }: { imports: ImportListItem[]; showAccount: boolean }) {
  const locale = useLocale();
  const today = useToday();
  const t = useTranslations("import.history");
  const tUndo = useTranslations("import.undo");
  const [undoing, setUndoing] = useState<ImportListItem | null>(null);

  if (imports.length === 0) return null;
  return (
    <>
      <HomeSection headingId="import-history-heading" title={t("heading")} flush>
        <ul className="divide-border divide-y text-sm" aria-label={t("heading")}>
          {imports.map((item) => (
            <li key={item.id} className="grid grid-cols-[1fr_44px] items-center gap-2 py-2 pr-1 pl-3.5">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold break-all">
                  {item.kind === "sync" ? t("synced", { bank: item.filename }) : item.filename}
                </span>
                <span className="text-muted-foreground text-xs">{formatShortInstantTime(item.uploadedAt, today, locale)}</span>
                <span className="text-muted-foreground text-xs">
                  {showAccount && <span className="break-all">{item.accountName} · </span>}
                  {t("summary", { inserted: item.rowsInserted })}
                  {item.rowsError > 0 && <> · {t("unreadable", { count: item.rowsError })}</>}
                </span>
              </span>
              {/* Sync runs have no Undo: undone rows would come back on the next sync. */}
              {item.kind === "csv" ? (
                <RowMenu
                  label={t("options", { filename: item.filename })}
                  items={[{ label: tUndo("confirm"), destructive: true, onSelect: () => setUndoing(item) }]}
                />
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      </HomeSection>
      {undoing && (
        <UndoImportDialog
          open
          onOpenChange={(open) => {
            if (!open) setUndoing(null);
          }}
          importId={undoing.id}
          filename={undoing.filename}
          rowsInserted={undoing.rowsInserted}
        />
      )}
    </>
  );
}
