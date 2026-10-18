import type { LoanData } from "@/db/queries/loans";
import type { Locale } from "@/i18n/config";
import { formatMonthLabel, inSentence } from "@/lib/dashboard/month";
import { formatRate } from "@/lib/loans/format";
import { loanView } from "@/lib/loans/view";
import { formatCents } from "@/lib/money";

/** What a loan's row on Comptes shows, already formatted (the client only picks words). */
export interface LoanRowView {
  id: string;
  name: string;
  owedCents: number;
  owedLabel: string;
  percent: number;
  rateLabel: string;
  /** "octobre 2031": when the last payment falls. */
  endLabel: string;
  /** Set while the loan is still in its first (interest-only or lower) phase. */
  phaseUntilLabel: string | null;
  done: boolean;
}

export function loanRow(data: LoanData, today: string, locale: Locale): LoanRowView {
  const view = loanView({ loan: data.loan, checkpoints: data.checkpoints, payments: data.payments, splits: data.splits, item: data.item }, today);
  const until = data.loan.currentPaymentUntil;
  return {
    id: data.loan.id,
    name: data.loan.name,
    owedCents: view.owedCents,
    owedLabel: formatCents(-view.owedCents, locale),
    percent: view.repaidPercent,
    rateLabel: formatRate(data.loan.rateThousandths, locale),
    endLabel: inSentence(formatMonthLabel(view.endDate.slice(0, 7), locale), locale),
    phaseUntilLabel: until && until >= today ? inSentence(formatMonthLabel(until.slice(0, 7), locale), locale) : null,
    done: view.owedCents === 0,
  };
}
