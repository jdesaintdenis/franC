"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { claimReturnFocus } from "@/components/manage/return-focus";
import { cn } from "@/lib/utils";

import { keyboardInset } from "./keyboard-inset";
import { useBackCloses } from "./back-closes";

function Sheet({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...useBackCloses(props)} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

/**
 * A bottom sheet on phones (grab handle, rounded top, its own scroll, safe-area padding) that
 * becomes a centred dialog from `lg`. Focus trap, Escape and overlay tap come from Radix. Above the phone
 * keyboard: follows the visual viewport.
 */
function SheetContent({
  title,
  description,
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  style,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  const t = useTranslations("common.actions");
  const returnFocus = React.useRef<HTMLElement | null>(null);
  // Follow the visual viewport so a bottom sheet sits above the phone keyboard (see keyboard-inset.ts).
  const [viewport, setViewport] = React.useState<{ inset: number; height: number } | null>(null);
  React.useEffect(() => {
    const visual = window.visualViewport;
    if (!visual) return;
    function update() {
      if (visual) setViewport({ inset: keyboardInset(window.innerHeight, visual), height: visual.height });
    }
    // On a resize (keyboard opening), bring the focused field back into view inside the sheet.
    function onResize() {
      update();
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest('[data-slot="sheet-content"]') && focused.matches("input, textarea, select")) {
        focused.scrollIntoView({ block: "nearest" });
      }
    }
    update();
    visual.addEventListener("resize", onResize);
    visual.addEventListener("scroll", update);
    return () => {
      visual.removeEventListener("resize", onResize);
      visual.removeEventListener("scroll", update);
    };
  }, []);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="sheet-overlay"
        className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50"
      />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        // Radix warns about a missing description; passing undefined says there is none on purpose.
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "bg-card fixed inset-x-0 bottom-[var(--keyboard-inset,0px)] z-50 flex max-h-[calc(var(--visual-height,100dvh)*0.9)] flex-col gap-4 overflow-y-auto overscroll-contain rounded-t-3xl border-t px-5 pt-2.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-lg outline-none duration-200",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "max-lg:data-[state=open]:slide-in-from-bottom max-lg:data-[state=closed]:slide-out-to-bottom",
          "lg:inset-x-auto lg:top-1/2 lg:bottom-auto lg:left-1/2 lg:max-h-[calc(100dvh-4rem)] lg:w-full lg:max-w-lg lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:border lg:p-6 lg:data-[state=closed]:zoom-out-95 lg:data-[state=open]:zoom-in-95",
          className,
        )}
        style={
          {
            ...(viewport ? { "--keyboard-inset": `${viewport.inset}px`, "--visual-height": `${viewport.height}px` } : {}),
            ...style,
          } as React.CSSProperties
        }
        onOpenAutoFocus={(event) => {
          returnFocus.current = claimReturnFocus();
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          const target = returnFocus.current;
          returnFocus.current = null;
          if (!event.defaultPrevented && target?.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
        {...props}
      >
        <div aria-hidden="true" className="bg-border mx-auto h-1.5 w-10 shrink-0 rounded-full lg:hidden" />
        <div className="flex flex-col gap-1 pr-12">
          <DialogPrimitive.Title data-slot="sheet-title" className="text-lg font-bold tracking-tight">
            {title}
          </DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description data-slot="sheet-description" className="text-muted-foreground text-sm">
              {description}
            </DialogPrimitive.Description>
          )}
        </div>
        {children}
        <DialogPrimitive.Close className="bg-muted hover:bg-accent focus-visible:ring-ring/50 absolute top-3 right-3 flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] lg:top-4 lg:right-4">
          <XIcon className="size-5" aria-hidden="true" />
          <span className="sr-only">{t("close")}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetClose, SheetContent, SheetTrigger };
