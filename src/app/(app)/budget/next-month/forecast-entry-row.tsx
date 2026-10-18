import { useLocale } from "next-intl";
import Link from "next/link";
import type { ForecastEntry } from "@/lib/recurring/forecast";
import { formatDay } from "@/lib/format-date";
import { ExpectedAmount } from "@/components/expected-amount";
import { cn } from "@/lib/utils";

import { DetectedBadge } from "@/app/(app)/recurring/detected-badge";

/** One projected occurrence. Detected (unconfirmed) items are muted with a dashed border plus a pill. */
export function ForecastEntryRow({
  entry,
  today,
  compact,
  href,
}: {
  entry: ForecastEntry;
  today: string;
  /** Home's short list: no "Detected" pill or dashed border (Recurring shows the status). */
  compact?: boolean;
  /** Makes the whole row a link (Home opens the item's sheet on Recurring). */
  href?: string;
}) {
  const locale = useLocale();
  const detected = entry.status === "detected" && !compact;
  const content = (
    <>
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs tabular-nums">{formatDay(entry.date, today, locale)}</p>
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="wrap-anywhere">{entry.name}</span>
          {detected && <DetectedBadge />}
        </p>
      </div>
      <p
        className={cn(
          "shrink-0 text-sm font-medium tabular-nums",
          entry.amountCents > 0 && "text-positive",
        )}
      >
        <ExpectedAmount cents={entry.amountCents} tracked={entry.tracked === true} />
      </p>
    </>
  );
  const rowClass = "flex items-start justify-between gap-3 px-3 py-2";
  return (
    <li className={cn("rounded-lg border", detected && "border-dashed bg-muted/40 text-muted-foreground")}>
      {href ? (
        <Link href={href} className={cn(rowClass, "hover:bg-muted/60 focus-visible:ring-ring/50 rounded-lg outline-none focus-visible:ring-[3px]")}>
          {content}
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
}
