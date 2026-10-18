import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A full-width tappable row that leads somewhere deeper: optional icon chip, a title, an
 * optional hint, and a chevron. At least 48 px tall so it is an easy target on a phone.
 * Put several in a bordered `divide-y` list, or use one on its own.
 */
export function RowLink({
  href,
  title,
  hint,
  icon,
  className,
  scroll,
}: {
  href: string;
  title: ReactNode;
  hint?: ReactNode;
  /** Usually a lucide icon; drawn in a brand-tinted chip. */
  icon?: ReactNode;
  className?: string;
  /** False keeps the scroll position: for links that stay on the same page. */
  scroll?: boolean;
}) {
  return (
    <Link
      href={href}
      scroll={scroll}
      className={cn(
        "hover:bg-muted/60 active:bg-muted focus-visible:ring-ring/50 flex min-h-12 items-center gap-3 px-4 py-3 outline-none focus-visible:ring-[3px] focus-visible:ring-inset",
        className,
      )}
    >
      {icon && (
        <span aria-hidden="true" className="bg-brand-soft text-brand flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5">
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{title}</span>
        {hint && <span className="text-muted-foreground text-sm">{hint}</span>}
      </span>
      <ChevronRight className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
    </Link>
  );
}

/**
 * The last line of a card that opens the full view ("See all", "Manage goals"): brand-blue
 * text, a chevron, and a divider above. Place it as the card's last child.
 */
export function CardFooterLink({
  href,
  children,
  className,
  scroll,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  /** False keeps the scroll position: for links that stay on the same page. */
  scroll?: boolean;
}) {
  return (
    <Link
      href={href}
      scroll={scroll}
      className={cn(
        "text-brand hover:bg-muted/60 active:bg-muted focus-visible:ring-ring/50 flex min-h-12 items-center justify-between gap-3 border-t px-4 text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-inset",
        className,
      )}
    >
      <span>{children}</span>
      <ChevronRight className="size-5 shrink-0" aria-hidden="true" />
    </Link>
  );
}
