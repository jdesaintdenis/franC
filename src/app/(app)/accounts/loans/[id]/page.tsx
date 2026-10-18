import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { PageTitle } from "@/components/page-title";
import { db } from "@/db/client";
import { getLoan, listLoanPaymentChoices } from "@/db/queries/loans";
import { requireUser } from "@/lib/auth/session";
import { currentDate, formatMonthLabel, inSentence } from "@/lib/dashboard/month";
import { loanView } from "@/lib/loans/view";
import { z } from "zod";

import type { LedgerEntry } from "@/lib/loans/ledger";

import type { LoanCurvePoint } from "../loan-curve";
import { LoanScreen, type LoanPageData } from "../loan-screen";

/** The curve before the first figure: the computed deferral, the one estimated segment, then the real payments. */
function historyCurve(history: LedgerEntry[], startedOn: string | null, borrowedCents: number, label: (iso: string) => string): LoanCurvePoint[] {
  if (!startedOn || history.length === 0) return [];
  const points: LoanCurvePoint[] = [];
  const first = history[0];
  points.push({ date: startedOn, label: label(startedOn), owedCents: borrowedCents, kind: first.kind === "deferral" ? "computed" : first.kind === "estimated" ? "estimated" : "real" });
  for (const entry of history) {
    if (entry.kind === "deferral") points.push({ date: entry.to, label: label(entry.to), owedCents: borrowedCents, kind: "computed" });
    else if (entry.kind === "estimated") points.push({ date: entry.to, label: label(entry.to), owedCents: entry.owedAfterCents, kind: "estimated" });
    else points.push({ date: entry.date, label: label(entry.date), owedCents: entry.owedAfterCents, kind: "real" });
  }
  return points;
}

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [data, payments, locale, t] = await Promise.all([
    getLoan(db, user.id, id.data),
    listLoanPaymentChoices(db, user.id),
    getLocale(),
    getTranslations("settings.loans"),
  ]);
  if (!data) notFound();

  const today = currentDate(new Date());
  const view = loanView({ loan: data.loan, checkpoints: data.checkpoints, payments: data.payments, splits: data.splits, item: data.item }, today);
  const [start] = data.checkpoints;
  const label = (iso: string) => inSentence(formatMonthLabel(iso.slice(0, 7), locale), locale);
  const startedOn = data.loan.startedOn;
  const until = data.loan.currentPaymentUntil;

  const page: LoanPageData = {
    loan: {
      id: data.loan.id,
      name: data.loan.name,
      borrowedCents: data.loan.borrowedCents,
      owedCents: start.owedCents,
      owedOn: start.date,
      rateThousandths: data.loan.rateThousandths,
      insuranceCents: data.loan.insuranceCents,
      insuranceRateThousandths: data.loan.insuranceRateThousandths,
      lastPaymentOn: data.loan.lastPaymentOn,
      currentPaymentUntil: until,
      startedOn,
      amortizationFrom: data.loan.amortizationFrom,
      recurringId: data.loan.recurringId,
    },
    owedCents: view.owedCents,
    percent: view.repaidPercent,
    nextDue: view.nextDue,
    nextAmountCents: view.projection.months[0]?.paymentCents ?? (data.item ? Math.abs(data.item.typicalAmountCents) : null),
    endDate: view.endDate,
    phaseUntil: until && until >= today ? until : null,
    entries: [...view.history, ...view.ledger.entries].reverse(),
    length: startedOn ? view.length : { ...view.length, monthsTotal: 0, monthsPaid: 0 },
    hasStart: startedOn !== null,
    lastPaymentOn: data.loan.lastPaymentOn,
    deferralCostCents: view.deferralCostCents,
    estimatedCostCents: view.estimatedCostCents,
    todayDate: today,
    changes: Object.fromEntries(view.changeFromPreviousCents),
    paidInterestAndInsuranceCents: view.paidInterestAndInsuranceCents,
    interestLeftCents: view.projection.interestLeftCents,
    insuranceLeftCents: view.projection.insuranceLeftCents,
    curve: [
      ...historyCurve(view.history, startedOn, data.loan.borrowedCents, label),
      { date: start.date, label: label(start.date), owedCents: start.owedCents, kind: "real" as const },
      ...view.ledger.entries.flatMap((e) => (e.kind === "payment" || e.kind === "correction" ? [{ date: e.date, label: label(e.date), owedCents: e.owedAfterCents, kind: "real" as const }] : [])),
      ...(view.owedCents > 0 ? view.projection.months.map((m) => ({ date: m.date, label: label(m.date), owedCents: m.owedAfterCents, kind: "projected" as const })) : []),
    ],
    projectionInput: view.nextDue ? view.projectionInput : null,
    payments: payments.map((p) => ({ id: p.id, name: p.name, typicalAmountCents: p.typicalAmountCents })),
  };

  return (
    <div className="theme-50f bg-50f flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 pb-4 md:px-8">
        <PageHeader back={{ href: "/accounts", label: t("page.back") }} title={<PageTitle>{data.loan.name}</PageTitle>} />
        <LoanScreen data={page} today={today} />
      </main>
    </div>
  );
}
