"use client";

import { SmilePlus } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

// Loaded on first render, which only happens once the dialog is open (see below).
const EmojiPickerPanel = dynamic(() => import("./emoji-picker-panel"), {
  ssr: false,
  loading: () => <PickerPlaceholder />,
});

function PickerPlaceholder() {
  const t = useTranslations("settings.categories.form.icon");
  return (
    <div role="status" className="text-muted-foreground flex h-80 items-center justify-center text-sm">
      {t("loading")}
    </div>
  );
}

/**
 * Icon chooser for the category form: a square button showing the current emoji that opens a
 * picker dialog. The value travels with the form in a hidden `icon` input ("" clears it).
 */
export function IconField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (icon: string) => void;
}) {
  const t = useTranslations("settings.categories.form.icon");
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{t("label")}</Label>
      <input type="hidden" name="icon" value={value} />
      <Button
        id={id}
        type="button"
        variant="outline"
        className="h-10 w-14 text-xl"
        aria-haspopup="dialog"
        aria-label={value ? t("change", { icon: value }) : t("choose")}
        onClick={() => setOpen(true)}
      >
        {value ? (
          <span aria-hidden="true">{value}</span>
        ) : (
          <SmilePlus aria-hidden="true" className="text-muted-foreground size-5" />
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[calc(100%-1rem)] p-4 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          {/* Mounted only while open, so the picker chunk and data are fetched on first open. */}
          <EmojiPickerPanel
            onSelect={(emoji) => {
              onChange(emoji);
              setOpen(false);
            }}
          />
          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button
              type="button"
              variant="outline"
              className="h-10"
              disabled={!value}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              {t("remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
