"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Wordmark } from "@/components/wordmark";
import { activeSection, NAV_HREF, TAB_SECTIONS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { badgeText, NAV_ICON } from "./nav-items";

/** Desktop navigation from 1024 px: the bottom bar's entries down the left edge. */
export function AppSidebar({ reviewCount = 0 }: { reviewCount?: number }) {
  const pathname = usePathname();
  const current = activeSection(pathname);
  const t = useTranslations("common.nav");

  return (
    <nav
      aria-label={t("label")}
      className="theme-50f bg-card border-border sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r px-4 py-6 lg:flex"
    >
      <Link
        href="/"
        className="focus-visible:ring-ring/50 mb-4 rounded-md px-3 text-2xl outline-none focus-visible:ring-[3px]"
      >
        <Wordmark />
      </Link>
      <ul className="flex flex-col gap-1">
        {TAB_SECTIONS.map((section) => {
          const Icon = NAV_ICON[section];
          const isActive = current === section;
          const badge = section === "transactions" && reviewCount > 0;
          return (
            <li key={section}>
              <Link
                href={NAV_HREF[section]}
                aria-current={isActive ? "page" : undefined}
                aria-label={
                  badge
                    ? t("transactionsWithReview", { count: reviewCount })
                    : undefined
                }
                className={cn(
                  "focus-visible:ring-ring/50 flex h-11 items-center gap-3 rounded-xl px-3 outline-none focus-visible:ring-[3px]",
                  isActive
                    ? "bg-brand-soft text-brand font-semibold"
                    : "text-foreground/80 hover:bg-muted",
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                <span className="flex-1">{t(section)}</span>
                {badge && (
                  <span
                    aria-hidden="true"
                    className="bg-primary text-primary-foreground flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums"
                  >
                    {badgeText(reviewCount)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
