"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { rememberReturnFocus } from "./return-focus";
import { RowMenu, type RowMenuItem } from "./row-menu";

/**
 * One row of a management list: marker, a name that wraps (never truncated), one caption line,
 * an optional value on the right, then the "⋯" menu. Tapping the row runs `onOpen` (its edit
 * sheet), so the usual action is one tap and every other one is one menu away.
 */
export function ManageRow({
  marker,
  name,
  caption,
  value,
  children,
  onOpen,
  openLabel,
  action,
  menuLabel,
  menu,
  nested = false,
  className,
  testId,
}: {
  marker?: ReactNode;
  name: ReactNode;
  caption?: ReactNode;
  value?: ReactNode;
  /** Extra content under the name (a progress bar). */
  children?: ReactNode;
  onOpen?: () => void;
  /** Accessible name of the row button, such as "Edit Groceries". */
  openLabel?: string;
  /** A quick action shown before the ⋯ menu, such as ＋. */
  action?: ReactNode;
  menuLabel: string;
  menu: RowMenuItem[];
  nested?: boolean;
  className?: string;
  testId?: string;
}) {
  const body = (
    <>
      {marker}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("wrap-anywhere", nested ? "font-medium" : "font-semibold")}>{name}</span>
        {caption && <span className="text-muted-foreground text-sm">{caption}</span>}
        {children}
      </span>
      {value && <span className="shrink-0 text-right font-semibold tabular-nums">{value}</span>}
    </>
  );
  return (
    <div className={cn("flex items-center gap-1 pr-1", nested ? "pl-8" : "pl-1", className)} data-testid={testId}>
      {onOpen ? (
        <button
          type="button"
          onClick={(event) => {
            rememberReturnFocus(event.currentTarget);
            onOpen();
          }}
          aria-label={openLabel}
          className="hover:bg-accent/60 active:bg-accent focus-visible:ring-ring/50 flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none focus-visible:ring-[3px]"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2.5">{body}</div>
      )}
      {action}
      <RowMenu label={menuLabel} items={menu} />
    </div>
  );
}
