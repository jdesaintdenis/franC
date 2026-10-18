"use client";

import { useTranslations } from "next-intl";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SHORTCUT_HELP } from "@/lib/review/shortcuts";

export function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("transactions.review.shortcuts");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {SHORTCUT_HELP.map(({ keys, action }) => (
            <div key={action} className="contents">
              <dt className="flex gap-1">
                {keys.map((k) => (
                  <kbd key={k} className="bg-muted text-foreground min-w-6 rounded border px-1.5 py-0.5 text-center font-mono text-xs">
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd>{t(`actions.${action}`)}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
