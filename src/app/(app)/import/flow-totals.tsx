"use client";

import { useLocale, useTranslations } from "next-intl";

import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/** "+1 234,00 €" for gains, the plain (negative) figure otherwise; signs are not a locale option of `formatCents`. */
function signed(cents: number, locale: Parameters<typeof formatCents>[1]) {
  return `${cents > 0 ? "+" : ""}${formatCents(cents, locale)}`;
}

/** Money in, money out and the net of an import's new rows. */
export function FlowTotals({
  flows,
  size = "base",
}: {
  flows: { inCents: number; outCents: number; netCents: number };
  size?: "base" | "small";
}) {
  const t = useTranslations("import.preview");
  const locale = useLocale();
  const cells = [
    { label: t("flowIn"), cents: flows.inCents, tone: "text-positive" },
    { label: t("flowOut"), cents: flows.outCents, tone: "" },
    { label: t("flowNet"), cents: flows.netCents, tone: "" },
  ];
  return (
    <dl data-testid="import-flows" className="grid grid-cols-3">
      {cells.map((c, i) => (
        <div key={c.label} className={cn("flex min-w-0 flex-col gap-0.5 px-2", i === 0 ? "pl-0" : "border-border border-l")}>
          <dt className="text-muted-foreground text-xs">{c.label}</dt>
          <dd className={cn("font-bold whitespace-nowrap tabular-nums", size === "base" ? "text-base" : "text-[15px]", c.tone)}>
            {signed(c.cents, locale)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
