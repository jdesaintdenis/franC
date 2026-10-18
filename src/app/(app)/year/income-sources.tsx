import { useLocale } from "next-intl";
import Link from "next/link";

import { CategoryTile } from "@/components/category-tile";
import { percentShares } from "@/lib/dashboard/shares";
import { formatCents, formatPercent } from "@/lib/money";

import { incomeHref } from "./hrefs";

export interface IncomeRow {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string | null;
  amountCents: number;
}

/** Where the period's income came from: one row per source, each opening its transactions. */
export function IncomeSources({ rows, period }: { rows: IncomeRow[]; period: { month: string } | { year: number } }) {
  const locale = useLocale();
  const shares = percentShares(rows.map((r) => r.amountCents));
  return (
    <ul className="divide-border divide-y">
      {rows.map((r, i) => (
        <li key={r.categoryId ?? "none"}>
          <Link
            href={incomeHref(period, r.categoryId)}
            className="hover:bg-muted/60 focus-visible:ring-ring/50 grid min-h-14 grid-cols-[32px_1fr_auto_40px] items-center gap-2.5 px-3.5 py-2 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
          >
            <CategoryTile icon={r.icon} color={r.color} />
            <span className="truncate font-semibold">{r.name}</span>
            <span className="font-semibold tabular-nums">{formatCents(r.amountCents, locale)}</span>
            <span className="text-muted-foreground text-right text-xs tabular-nums">{formatPercent(shares[i] ?? 0, locale)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
