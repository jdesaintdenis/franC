"use client";

import { Landmark } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import type { TransactionListItem } from "@/db/queries/transactions";
import { formatCents } from "@/lib/money";

import { getLoanPaymentInfo, type LoanPaymentInfo } from "./actions";

/** "Repayment · Mortgage": how franC splits a bank row that pays a loan, with a link to the loan. Only asks for regular outflows. */
export function LoanLine({ item }: { item: TransactionListItem }) {
  const t = useTranslations("transactions.sheet.loan");
  const locale = useLocale();
  const asked = item.recurring !== null && item.amountCents < 0;
  const [info, setInfo] = useState<LoanPaymentInfo | null>(null);

  useEffect(() => {
    if (!asked) return;
    let cancelled = false;
    getLoanPaymentInfo({ transactionId: item.id })
      .then((result) => !cancelled && setInfo(result))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [asked, item.id]);

  if (!asked || !info) return null;
  return (
    <section aria-label={t("label")} data-testid="sheet-loan" className="bg-muted/40 flex flex-col gap-1 rounded-lg p-3 text-sm">
      <span className="flex items-center gap-2 font-semibold">
        <Landmark className="text-primary size-4" aria-hidden="true" />
        {t("title", { name: info.loanName })}
      </span>
      <span className="text-muted-foreground tabular-nums">
        {t("split", {
          capital: formatCents(info.capitalCents, locale),
          interest: formatCents(info.interestCents, locale),
          insurance: formatCents(info.insuranceCents, locale),
        })}
      </span>
      <Link href={`/accounts/loans/${info.loanId}`} className="text-primary font-semibold">
        {t("see")}
      </Link>
    </section>
  );
}
