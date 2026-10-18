"use client";

import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { rememberReturnFocus } from "./return-focus";

export interface RowMenuItem {
  label: string;
  icon?: ReactNode;
  /** Either an action or a link; links keep middle-click and the browser's own navigation. */
  onSelect?: () => void;
  href?: string;
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * The one "⋯" button per row of a management list. Destructive items go last, after a
 * separator, so a slip of the finger lands on something harmless.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const safe = items.filter((i) => !i.destructive);
  const destructive = items.filter((i) => i.destructive);
  const render = (item: RowMenuItem) =>
    item.href && !item.disabled ? (
      <DropdownMenuItem key={item.label} asChild destructive={item.destructive}>
        <Link href={item.href}>
          {item.icon}
          <span>{item.label}</span>
        </Link>
      </DropdownMenuItem>
    ) : (
      <DropdownMenuItem
        key={item.label}
        destructive={item.destructive}
        disabled={item.disabled}
        onSelect={() => {
          rememberReturnFocus(trigger.current);
          setOpen(false);
          // Runs once the menu has closed, so a sheet it opens or a row it moves never
          // races the menu's own close and focus handling.
          const run = item.onSelect;
          if (run) setTimeout(run, 0);
        }}
      >
        {item.icon}
        <span>{item.label}</span>
      </DropdownMenuItem>
    );

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        ref={trigger}
        aria-label={label}
        title={label}
        className="hover:bg-muted focus-visible:ring-ring/50 data-[state=open]:bg-brand-soft data-[state=open]:text-brand flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]"
      >
        <MoreHorizontal className="size-5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label={label}>
        {safe.map(render)}
        {destructive.length > 0 && safe.length > 0 && <DropdownMenuSeparator />}
        {destructive.map(render)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
