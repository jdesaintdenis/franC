"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type DragEvent, type RefObject } from "react";

import { cn } from "@/lib/utils";

/**
 * The first import screen: one card to choose or drop the bank's CSV. The native
 * input stays in the DOM (visually hidden) inside the <label>, so it keeps keyboard and
 * screen-reader behaviour; picking or dropping a file hands it to `onFile` at once.
 * The "where do I find this file" help sits inside the same card.
 */
export function DropZone({
  inputRef,
  onFile,
  pendingFilename,
  errorId,
  invalid,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
  /** Set while the file is being read: the area shows a spinner and the name. */
  pendingFilename: string | null;
  errorId?: string;
  invalid?: boolean;
}) {
  const t = useTranslations("import.flow");
  const [dragging, setDragging] = useState(false);
  const pending = pendingFilename !== null;

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && !pending) onFile(dropped);
  }

  return (
    <div className={cn("bg-card flex flex-col rounded-[10px] border", dragging && "ring-primary ring-2")}>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "focus-within:ring-ring/50 flex min-h-40 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] p-5 text-center focus-within:ring-[3px]",
          pending && "cursor-progress",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          aria-label={t("chooseLabel")}
          aria-invalid={invalid || undefined}
          aria-describedby={errorId}
          disabled={pending}
          className="sr-only"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (!chosen) return;
            onFile(chosen);
            // Cleared so choosing the same file again (after an error) still fires change.
            e.target.value = "";
          }}
        />
        {pending ? (
          <>
            <Loader2 aria-hidden="true" className="text-primary size-8 animate-spin motion-reduce:animate-none" />
            <span role="status" className="text-base font-medium break-all">
              {t("readingFile", { filename: pendingFilename })}
            </span>
          </>
        ) : (
          <>
            <span aria-hidden="true" className="bg-secondary text-primary flex size-12 items-center justify-center rounded-[14px]">
              <FileUp className="size-6" />
            </span>
            <span className="text-base font-bold">{t("dropTitle")}</span>
            <span className="text-muted-foreground text-sm">{t("dropHint")}</span>
            <span className="text-muted-foreground hidden text-sm md:inline">{t("dropOrDrop")}</span>
          </>
        )}
      </label>
      <details className="border-t px-4 text-sm">
        <summary className="text-primary focus-visible:ring-ring/50 flex min-h-11 w-full cursor-pointer items-center rounded-md text-[13px] font-semibold outline-none focus-visible:ring-[3px]">
          {t("helpTitle")}
        </summary>
        <div className="text-muted-foreground flex flex-col gap-2 pb-3">
          <p>{t("helpBody")}</p>
          <p>{t("helpBody2")}</p>
        </div>
      </details>
    </div>
  );
}
