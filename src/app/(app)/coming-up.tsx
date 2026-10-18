import { CalendarDays } from "lucide-react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/empty-state";
import type { ForecastEntry } from "@/lib/recurring/forecast";

import { ForecastEntryRow } from "./budget/next-month/forecast-entry-row";

// The Budget page shows only what is due next; the full list lives on Recurring and the forecast one page away.
const MAX_ENTRIES = 3;

/** The next payments, inside the page's "À venir" section. */
export function ComingUp({
  entries,
  today,
}: {
  entries: ForecastEntry[];
  /** "YYYY-MM-DD" in Europe/Paris. */
  today: string;
}) {
  const t = useTranslations("dashboard.comingUp");
  if (entries.length === 0) return <EmptyState compact headingLevel="h3" icon={CalendarDays} title={t("empty")} className="px-0" />;
  return (
    <ul aria-label={t("heading")} className="flex flex-col gap-2">
      {entries.slice(0, MAX_ENTRIES).map((entry) => (
        <ForecastEntryRow key={`${entry.id}-${entry.date}`} entry={entry} today={today} compact href={`/recurring?item=${entry.id}`} />
      ))}
    </ul>
  );
}
