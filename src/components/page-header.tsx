import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one header every app page uses: an optional back arrow, the page's only <h1>, and at
 * most one action on the right. Works in server and client components alike.
 */
export function PageHeader({
  title,
  back,
  action,
  eyebrow,
  className,
  titleTestId,
  engraved = false,
}: {
  title: ReactNode;
  /** `label` is the accessible name, such as "Back to Plan". */
  back?: { href: string; label: string };
  action?: ReactNode;
  /** Small line above the title (a date, a count). */
  eyebrow?: ReactNode;
  className?: string;
  titleTestId?: string;
  /** The 50 F title: small engraved Cinzel capitals in the accent colour. */
  engraved?: boolean;
}) {
  return (
    <header className={cn("flex items-center gap-2 pt-4 md:pt-8", className)}>
      {back && (
        <Link
          href={back.href}
          aria-label={back.label}
          title={back.label}
          className="hover:bg-muted focus-visible:ring-ring/50 -ml-2 flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {eyebrow && <p className="text-muted-foreground text-sm">{eyebrow}</p>}
        <h1
          className={engraved ? "font-title text-primary text-[13px] font-semibold tracking-[0.14em] uppercase" : "text-2xl font-bold tracking-tight"}
          data-testid={titleTestId}
        >
          {title}
        </h1>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </header>
  );
}
