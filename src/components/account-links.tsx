import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Row of links that scopes a page to one account. Wraps on narrow screens;
 * plain links so it works without JS. Pages render it only when the user has
 * more than one account.
 */
export async function AccountLinks({
  accounts,
  activeId,
  hrefFor,
}: {
  accounts: { id: string; name: string }[];
  activeId: string | null;
  /** Null asks for the "All accounts" link. */
  hrefFor: (accountId: string | null) => string;
}) {
  const t = await getTranslations("common.accounts");
  const entries = [{ id: null as string | null, name: t("all") }, ...accounts];
  return (
    <nav aria-label={t("filterLabel")}>
      <ul className="flex flex-wrap gap-2">
        {entries.map((entry) => {
          const active = entry.id === activeId;
          return (
            <li key={entry.id ?? "all"}>
              <Link
                href={hrefFor(entry.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "focus-visible:ring-ring/50 inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-[3px]",
                  active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
                )}
              >
                {entry.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
