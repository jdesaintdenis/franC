/**
 * The app's main sections, shared by the phone bottom bar and the desktop sidebar so the two
 * never drift apart. Budgets and Goals live under /settings but belong to Plan, Accounts (with
 * the bank connection and the CSV import) is its own tab, and More is the /settings page itself.
 */
export type NavSection = "home" | "transactions" | "plan" | "accounts" | "more";

export const NAV_HREF: Record<NavSection, string> = {
  home: "/",
  transactions: "/transactions",
  plan: "/budget",
  accounts: "/accounts",
  more: "/settings",
};

/** The five tabs, in bar and sidebar order; the same for every user (SPEC §76). */
export const TAB_SECTIONS: readonly NavSection[] = ["home", "transactions", "plan", "accounts", "more"];

const PLAN_PREFIXES = ["/budget", "/settings/budgets", "/settings/goals", "/recurring", "/year"];

/** True when `pathname` is `prefix` or one of its sub-paths ("/year" matches "/year/x", not "/yearly"). */
function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Which section a page belongs to, or null for pages outside the navigation. */
export function activeSection(pathname: string): NavSection | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path === "/") return "home";
  if (under(path, "/transactions") || under(path, "/review")) return "transactions";
  if (under(path, "/accounts") || under(path, "/import")) return "accounts";
  if (PLAN_PREFIXES.some((prefix) => under(path, prefix))) return "plan";
  if (under(path, "/settings")) return "more";
  return null;
}
