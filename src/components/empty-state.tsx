import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one empty-state look, modelled on Review's "All caught up": a round soft icon, a short
 * title, one sentence and one clear action (plus at most one quiet link). Works in server and
 * client components; `compact` is the in-card version (Home cards, sheet lists).
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  secondary,
  tone = "brand",
  compact = false,
  headingLevel = "h2",
  className,
  testId,
  children,
}: {
  icon: LucideIcon;
  title: ReactNode;
  body?: ReactNode;
  /** The one primary action: a Button or a Link styled with buttonVariants. */
  action?: ReactNode;
  /** A quiet secondary link, shown under the action. */
  secondary?: ReactNode;
  /** "positive" for a done state (All caught up); "brand" otherwise. Never red. */
  tone?: "brand" | "positive";
  compact?: boolean;
  headingLevel?: "h2" | "h3";
  className?: string;
  testId?: string;
  /** Anything screen-specific under the action (Budgets' inline suggestions). */
  children?: ReactNode;
}) {
  const Heading = headingLevel;
  return (
    <section
      data-testid={testId}
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "gap-2 px-4 py-5" : "gap-3 px-2 pt-6 pb-4 md:pt-10",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-full",
          compact ? "size-10" : "size-14",
          tone === "positive" ? "bg-positive-soft text-positive" : "bg-brand-soft text-brand",
        )}
      >
        <Icon className={compact ? "size-5" : "size-7"} />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <Heading className={cn("font-bold tracking-tight", compact ? "text-base" : "text-lg")}>{title}</Heading>
        {body && <p className="text-muted-foreground text-sm">{body}</p>}
      </div>
      {action && <div className="flex flex-wrap justify-center gap-2 pt-1">{action}</div>}
      {secondary && <div className="text-sm">{secondary}</div>}
      {children}
    </section>
  );
}
