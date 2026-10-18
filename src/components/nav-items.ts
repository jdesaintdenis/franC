import { ChartPie, Ellipsis, Home, Landmark, List, type LucideIcon } from "lucide-react";

import type { NavSection } from "@/lib/navigation";

export const NAV_ICON: Record<NavSection, LucideIcon> = {
  home: Home,
  transactions: List,
  plan: ChartPie,
  accounts: Landmark,
  more: Ellipsis,
};

/** Above this the review badge reads "99+". */
export const BADGE_CAP = 99;

export function badgeText(count: number): string {
  return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
}
