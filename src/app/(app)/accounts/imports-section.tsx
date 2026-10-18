import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { HomeSection } from "@/app/(app)/home/home-section";
import type { StaleAccount } from "@/lib/import-reminder/staleness";

import { ImportReminderSettings } from "../settings/import-reminder-settings";

/** Imports: the stale-account warnings, the CSV import entry, and the import reminder switch. */
export async function ImportsSection({
  stale,
  reminderDays,
  bankSyncAllowed,
  push,
}: {
  stale: StaleAccount[];
  reminderDays: number | null;
  bankSyncAllowed: boolean;
  push?: ReactNode;
}) {
  const t = await getTranslations("settings.accounts");
  return (
    <HomeSection headingId="imports-heading" title={t("sections.imports")} testId="imports-section" flush>
      <ul className="divide-border divide-y">
        {stale.map((s) => (
          <li
            key={s.accountId}
            className="flex min-h-[52px] items-center justify-between gap-3 px-3.5 py-2"
            data-testid="stale-account"
          >
            <span className="text-warning text-sm font-semibold wrap-anywhere">
              {t("imports.stale", { name: s.name, days: s.ageDays })}
            </span>
            <Link href={`/import?account=${s.accountId}`} className="text-primary shrink-0 font-semibold">
              {t("imports.import")}
            </Link>
          </li>
        ))}
        <li>
          <Link
            href="/import"
            className="hover:bg-muted/60 focus-visible:ring-ring/50 flex min-h-[52px] items-center gap-3 px-3.5 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">{t("imports.csv")}</span>
              <span className="text-muted-foreground text-sm">
                {bankSyncAllowed ? t("imports.csvHintSync") : t("imports.csvHint")}
              </span>
            </span>
            <ChevronRight className="text-muted-foreground size-[18px] shrink-0" aria-hidden="true" />
          </Link>
        </li>
        <li>
          <ImportReminderSettings days={reminderDays} push={push} />
        </li>
      </ul>
    </HomeSection>
  );
}
