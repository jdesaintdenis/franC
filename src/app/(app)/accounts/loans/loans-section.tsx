"use client";

import { Landmark, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { HomeSection } from "@/app/(app)/home/home-section";
import { BlockGauge } from "@/app/(app)/home/block-gauge";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatPercent } from "@/lib/money";
import { useLocale } from "next-intl";

import { LoanForm, type PaymentChoice } from "./loan-form";
import type { LoanRowView } from "./loan-row";

/** "Crédits" on Comptes: one row per loan (tap = its page) and the sheet that adds one. */
export function LoansSection({
  loans,
  totalLabel,
  payments,
  today,
}: {
  loans: LoanRowView[];
  /** Formatted sum still owed, or null when there are no loans. */
  totalLabel: string | null;
  payments: PaymentChoice[];
  today: string;
}) {
  const t = useTranslations("settings.loans");
  const locale = useLocale();
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <HomeSection
        headingId="loans-heading"
        title={t("section")}
        testId="loans-list"
        flush
        action={loans.length > 0 ? { label: t("add"), onClick: () => setAdding(true) } : undefined}
      >
        {loans.length === 0 ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="hover:bg-accent/60 text-primary flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left font-semibold"
          >
            <Plus className="size-[18px]" aria-hidden="true" />
            {t("track")}
          </button>
        ) : (
          <>
            {/* With one loan the row says the same thing. */}
            {loans.length > 1 && (
              <p className="text-muted-foreground flex justify-between px-4 pt-3 text-sm">
                <span>{t("total")}</span>
                <span className="text-foreground font-semibold tabular-nums" data-testid="loans-total">{totalLabel}</span>
              </p>
            )}
            <ul aria-label={t("listLabel")} className="divide-border divide-y">
              {loans.map((loan) => (
                <li key={loan.id}>
                  <Link
                    href={`/accounts/loans/${loan.id}`}
                    className="hover:bg-accent/60 focus-visible:ring-ring/50 flex flex-col gap-2 px-4 py-3 outline-none focus-visible:ring-[3px]"
                  >
                    <span className="flex items-center gap-3">
                      <span aria-hidden="true" className="bg-muted text-primary flex size-8 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-[18px]">
                        <Landmark />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-semibold wrap-anywhere">{loan.name}</span>
                        <span className="text-muted-foreground text-sm">
                          {loan.done
                            ? t("row.done")
                            : loan.phaseUntilLabel
                              ? t("row.phase", { rate: loan.rateLabel, until: loan.phaseUntilLabel })
                              : t("row.until", { rate: loan.rateLabel, end: loan.endLabel })}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end">
                        <span className="text-[19px] font-bold tabular-nums">{loan.owedLabel}</span>
                        <span className="text-muted-foreground text-xs tabular-nums">{t("row.repaid", { percent: formatPercent(loan.percent, locale) })}</span>
                      </span>
                    </span>
                    <BlockGauge percent={loan.percent} tone="sand" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </HomeSection>

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent className="theme-50f" title={t("form.newHeading")}>
          <LoanForm payments={payments} today={today} onSaved={(id) => router.push(`/accounts/loans/${id}`)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
