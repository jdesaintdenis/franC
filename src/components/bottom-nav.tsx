"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { activeSection, NAV_HREF, TAB_SECTIONS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { badgeText, NAV_ICON } from "./nav-items";

/** Phone and tablet navigation: five equal tabs, the same for everyone; the sidebar takes over from 1024 px. */
export function BottomNav({ reviewCount = 0 }: { reviewCount?: number }) {
  const pathname = usePathname();
  const current = activeSection(pathname);
  const t = useTranslations("common.nav");

  return (
    <nav
      aria-label={t("label")}
      className="theme-50f border-border bg-background fixed inset-x-0 bottom-0 z-50 border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid h-16 grid-cols-5">
        {TAB_SECTIONS.map((section) => {
          const Icon = NAV_ICON[section];
          const isActive = current === section;

          const badge = section === "transactions" && reviewCount > 0;
          return (
            <li key={section}>
              <Link
                href={NAV_HREF[section]}
                className={cn(
                  "focus-visible:ring-ring/50 active:bg-muted/60 relative flex h-full flex-col items-center justify-center gap-1 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-inset",
                  isActive
                    ? "text-brand font-semibold"
                    : "text-muted-foreground",
                )}
                aria-current={isActive ? "page" : undefined}
                aria-label={
                  badge
                    ? t("transactionsWithReview", { count: reviewCount })
                    : undefined
                }
              >
                {/* Indicator so the active tab isn't shown by color alone. */}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="bg-brand absolute inset-x-4 top-0 h-0.5 rounded-full"
                  />
                )}
                <span className="relative">
                  <Icon className="size-5" aria-hidden="true" />
                  {badge && (
                    <span
                      aria-hidden="true"
                      data-testid="review-badge"
                      className="bg-primary text-primary-foreground absolute -top-1.5 left-full -ml-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[11px] leading-none font-semibold tabular-nums"
                    >
                      {badgeText(reviewCount)}
                    </span>
                  )}
                </span>
                {t(section)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
