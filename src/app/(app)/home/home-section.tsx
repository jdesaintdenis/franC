import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * One titled section of Home. The title is an engraved Cinzel capital line with an optional link on
 * the right; the content sits in a solid card unless `bare` (the hero draws its own panel).
 */
export function HomeSection({
  headingId,
  id,
  title,
  link,
  action,
  note,
  aside,
  testId,
  bare = false,
  flush = false,
  children,
}: {
  headingId: string;
  /** Anchor target, e.g. "balance" for the links that lead to the accounts. */
  id?: string;
  title: string;
  link?: { href: string; label: string };
  /** The same place as `link`, for a button that opens a sheet or expands the list. */
  action?: { label: string; onClick: () => void };
  /** Faded text on the right of the title (a count), when there is no link. */
  note?: string;
  /** A control on the right of the title (a period button) when there is no link or action. */
  aside?: ReactNode;
  testId?: string;
  bare?: boolean;
  /** A card without padding, for lists whose rows reach the edges. */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={headingId} data-testid={testId} className="flex scroll-mt-4 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 px-1 pt-2">
        <h2 id={headingId} className="font-title text-primary text-xs font-semibold tracking-[0.14em] uppercase">
          {title}
        </h2>
        {link && (
          <Link
            href={link.href}
            className="font-title text-primary -my-3 inline-flex min-h-11 items-center text-[13px] font-semibold tracking-wide"
          >
            {link.label}
          </Link>
        )}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="font-title text-primary focus-visible:ring-ring/50 -my-3 inline-flex min-h-11 items-center rounded-md text-[13px] font-semibold tracking-wide outline-none focus-visible:ring-[3px]"
          >
            {action.label}
          </button>
        )}
        {note && <span className="text-muted-foreground text-xs">{note}</span>}
        {aside}
      </div>
      {bare ? children : <div className={cn("bg-card overflow-hidden rounded-lg border", !flush && "p-3.5")}>{children}</div>}
    </section>
  );
}
