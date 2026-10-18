import type { useTranslations } from "next-intl";

import type { Locale } from "@/i18n/config";
import { formatShortDay } from "@/lib/format-date";
import { formatCents } from "@/lib/money";

export interface BalanceGapView {
  accountId: string;
  /** Null for a single-account user and in the account's own sheet: the name adds nothing there. */
  name: string | null;
  /** The bank's change minus franC's movement: negative = the bank shows less than franC. */
  amountCents: number;
  from: string;
  to: string;
}

type GapTranslator = ReturnType<typeof useTranslations<"dashboard.balanceGap">>;

/** The gap as one sentence, worded from the sign (a bank figure below franC's, or above). */
export function gapSentence(t: GapTranslator, locale: Locale, gap: BalanceGapView, today: string): string {
  const params = {
    name: gap.name ?? "",
    amount: formatCents(Math.abs(gap.amountCents), locale),
    from: formatShortDay(gap.from, today, locale),
    to: formatShortDay(gap.to, today, locale),
  };
  const less = gap.amountCents < 0;
  if (gap.name === null) return t(less ? "less" : "more", params);
  return t(less ? "lessNamed" : "moreNamed", params);
}
