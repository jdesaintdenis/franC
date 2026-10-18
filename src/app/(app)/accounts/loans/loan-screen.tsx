"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { BlockGauge } from "@/app/(app)/home/block-gauge";
import { HomeSection } from "@/app/(app)/home/home-section";
import { ToastViewport, useToast } from "@/components/toast";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatMonthLabel, inSentence } from "@/lib/dashboard/month";
import { formatShortDay } from "@/lib/format-date";
import { formatRate } from "@/lib/loans/format";
import type { LedgerEntry } from "@/lib/loans/ledger";
import type { ProjectionInput } from "@/lib/loans/projection";
import { formatCents, formatPercent, formatSignedCents } from "@/lib/money";
import { networkErrorMessage } from "@/lib/offline";
import type { LoanSnapshot } from "@/db/queries/loans";

import { deleteLoanAction, deleteLoanCorrectionAction, restoreLoanAction } from "./actions";
import { LoanCurve, type LoanCurvePoint } from "./loan-curve";
import { LoanForm, type LoanFormDefaults, type PaymentChoice } from "./loan-form";
import { CorrectionForm, Simulator, SplitForm, type SplitPayment } from "./loan-sheets";

export interface LoanPageData {
  loan: LoanFormDefaults;
  owedCents: number;
  percent: number;
  /** Null once repaid. */
  nextDue: string | null;
  nextAmountCents: number | null;
  endDate: string;
  /** Still in the first phase (deferral / lower payment) until this date. */
  phaseUntil: string | null;
  /** Newest first. */
  entries: LedgerEntry[];
  changes: Record<string, number>;
  paidInterestAndInsuranceCents: number;
  interestLeftCents: number;
  insuranceLeftCents: number;
  curve: LoanCurvePoint[];
  length: { monthsTotal: number; monthsPaid: number; monthsLeft: number };
  /** The loan has a subscription date: the length line counts from it. */
  hasStart: boolean;
  lastPaymentOn: string;
  deferralCostCents: number;
  estimatedCostCents: number;
  todayDate: string;
  projectionInput: ProjectionInput | null;
  payments: PaymentChoice[];
}

const SHOWN = 6;
const ROW = "flex w-full items-center gap-3 px-4 py-3 text-left";

export function LoanScreen({ data, today }: { data: LoanPageData; today: string }) {
  const t = useTranslations("settings.loans");
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [sheet, setSheet] = useState<"edit" | "correct" | "simulate" | { payment: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { loan } = data;

  const close = () => setSheet(null);
  const entries = showAll ? data.entries : data.entries.slice(0, SHOWN);
  const month = (iso: string) => inSentence(formatMonthLabel(iso.slice(0, 7), locale), locale);
  const payment = typeof sheet === "object" && sheet ? data.entries.find((e) => e.kind === "payment" && e.transactionId === sheet.payment) : undefined;
  const splitPayment: SplitPayment | null =
    payment?.kind === "payment"
      ? { transactionId: payment.transactionId, paidCents: payment.paidCents, interestCents: payment.interestCents, insuranceCents: payment.insuranceCents, corrected: payment.corrected }
      : null;

  const undoDelete = (snapshot: LoanSnapshot) => async () => {
    const result = await restoreLoanAction(snapshot);
    if (result.status === "ok") router.push(`/accounts/loans/${snapshot.loan.id}`);
    else toast.show({ message: result.error, variant: "error" });
  };

  const remove = () =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await deleteLoanAction(loan.id);
        if (result.status === "error") return setError(result.error);
        toast.show({ message: t("toast.deleted", { name: loan.name }), undo: { onUndo: undoDelete(result.snapshot) } });
        router.push("/accounts");
      } catch {
        setError(networkErrorMessage(t("errors.deleteFailed"), t("offline")));
      }
    });

  const removeCorrection = (checkpointId: string) =>
    startTransition(async () => {
      const result = await deleteLoanCorrectionAction(loan.id, checkpointId);
      if (result.status === "error") toast.show({ message: result.error, variant: "error" });
      else router.refresh();
    });

  return (
    <>
      <section aria-labelledby="loan-owed-label" className="hero-50f flex flex-col gap-2 rounded-lg p-4" data-testid="loan-hero">
        <span id="loan-owed-label" className="text-muted-foreground text-xs">
          {t("page.owed")}
        </span>
        <span className="text-[30px] leading-none font-extrabold tabular-nums" data-testid="loan-owed">
          {formatCents(-data.owedCents, locale)}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("page.repaid", { percent: formatPercent(data.percent, locale), borrowed: formatCents(loan.borrowedCents, locale) })}
        </span>
        <BlockGauge percent={data.percent} tone="sand" />
        <p className="text-sm">
          {data.nextDue
            ? t("page.next", { date: formatShortDay(data.nextDue, today, locale), amount: data.nextAmountCents === null ? "—" : formatCents(data.nextAmountCents, locale) })
            : t("page.done")}
        </p>
        <p className="text-muted-foreground text-xs">
          {data.phaseUntil ? t("page.phase", { until: month(data.phaseUntil) }) : null}
          {data.phaseUntil ? " · " : null}
          {t("page.ends", { rate: formatRate(loan.rateThousandths, locale), end: month(data.endDate) })}
        </p>
        <p className="text-sm" data-testid="loan-length">
          {data.hasStart
            ? t("page.length", { total: data.length.monthsTotal, paid: data.length.monthsPaid, left: data.length.monthsLeft })
            : t("page.lengthLeft", { left: data.length.monthsLeft })}
        </p>
        <p className="text-muted-foreground text-xs" data-testid="loan-contract-end">
          {t("page.contractEnd", { date: formatShortDay(data.lastPaymentOn, "1900-01-01", locale) })}
        </p>
        {data.owedCents > 0 && data.lastPaymentOn <= today && (
          <p className="text-warning flex items-start gap-2 text-sm" role="status" data-testid="loan-end-passed">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {t("page.endPassed")}{" "}
              <button type="button" className="underline" onClick={() => setSheet("edit")}>
                {t("page.fixEnd")}
              </button>
            </span>
          </p>
        )}
      </section>

      <HomeSection headingId="loan-payments-heading" title={t("page.payments")} testId="loan-payments" flush>
        {loan.recurringId === null && (
          <p className="text-warning flex items-start gap-2 px-4 py-3 text-sm" role="status">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {t("page.noPayment")}{" "}
              <button type="button" className="text-primary underline" onClick={() => setSheet("edit")}>
                {t("page.choosePayment")}
              </button>
            </span>
          </p>
        )}
        {entries.length === 0 ? (
          <p className="text-muted-foreground px-4 py-3 text-sm">{t("page.empty")}</p>
        ) : (
          <ul className="divide-border divide-y">
            {entries.map((entry) =>
              entry.kind === "payment" ? (
                <li key={entry.transactionId}>
                  <button type="button" className={`${ROW} hover:bg-accent/60 focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]`} onClick={() => setSheet({ payment: entry.transactionId })}>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold">{formatShortDay(entry.date, today, locale)}</span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {t(entry.insuranceCents > 0 ? "page.split" : "page.splitNoInsurance", {
                          capital: formatCents(entry.capitalCents, locale),
                          interest: formatCents(entry.interestCents, locale),
                          insurance: formatCents(entry.insuranceCents, locale),
                        })}
                      </span>
                      {Math.abs(data.changes[entry.transactionId] ?? 0) >= 100 && (
                        <span className="text-warning text-xs tabular-nums">
                          {data.changes[entry.transactionId] < 0
                            ? t("page.less", { amount: formatCents(-data.changes[entry.transactionId], locale) })
                            : t("page.more", { amount: formatCents(data.changes[entry.transactionId], locale) })}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 font-semibold tabular-nums">
                      {entry.corrected && <Check className="text-positive size-4" aria-label={t("page.corrected")} />}
                      {formatCents(-entry.paidCents, locale)}
                    </span>
                  </button>
                </li>
              ) : entry.kind === "deferral" || entry.kind === "estimated" ? (
                <li key={`${entry.kind}-${entry.from}`} className={ROW} data-testid={`loan-${entry.kind}`}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">
                      {t(entry.kind === "deferral" ? "page.deferralTitle" : "page.estimatedTitle")}
                      {entry.kind === "estimated" && (
                        <span className="text-muted-foreground ml-2 rounded-full border border-dashed px-2 py-0.5 text-[11px] font-semibold">{t("page.estimatedBadge")}</span>
                      )}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {t(entry.kind === "deferral" ? "page.deferralSpan" : "page.estimatedSpan", { from: month(entry.from), to: month(entry.to), count: entry.months })}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {entry.kind === "deferral"
                        ? t(entry.insuranceCents > 0 ? "page.deferralSplit" : "page.deferralSplitNoInsurance", {
                            interest: formatCents(entry.interestCents, locale),
                            insurance: formatCents(entry.insuranceCents, locale),
                          })
                        : t(entry.insuranceCents > 0 ? "page.estimatedSplit" : "page.estimatedSplitNoInsurance", {
                            capital: formatCents(entry.capitalCents, locale),
                            interest: formatCents(entry.interestCents, locale),
                            insurance: formatCents(entry.insuranceCents, locale),
                          })}
                    </span>
                  </span>
                </li>
              ) : (
                <li key={`c-${entry.date}-${entry.checkpointId ?? "gap"}`} className={ROW}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">{t("page.correction")}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatShortDay(entry.date, today, locale)} · {formatSignedCents(-entry.deltaCents, locale)}
                    </span>
                  </span>
                  {entry.checkpointId && (
                    <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => removeCorrection(entry.checkpointId as string)}>
                      {t("page.removeCorrection")}
                    </Button>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
        {data.entries.length > SHOWN && !showAll && (
          <button type="button" className="text-primary min-h-11 w-full px-4 text-left text-sm font-semibold" onClick={() => setShowAll(true)}>
            {t("page.seeAll", { count: data.entries.length })}
          </button>
        )}
      </HomeSection>

      {data.curve.length > 1 && (
        <HomeSection headingId="loan-curve-heading" title={t("page.curve")} testId="loan-curve-section">
          <LoanCurve data={data.curve} today={data.todayDate} endDate={data.lastPaymentOn} maxCents={loan.borrowedCents} />
        </HomeSection>
      )}

      <HomeSection headingId="loan-cost-heading" title={t("page.cost")} testId="loan-cost">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("page.paidSoFar")}</dt>
            <dd className="font-semibold tabular-nums">{formatCents(data.paidInterestAndInsuranceCents, locale)}</dd>
          </div>
          {data.deferralCostCents > 0 && (
            <p className="text-muted-foreground -mt-1 text-xs tabular-nums">{t("page.costDeferral", { amount: formatCents(data.deferralCostCents, locale) })}</p>
          )}
          {data.estimatedCostCents > 0 && (
            <p className="text-muted-foreground -mt-1 text-xs tabular-nums">{t("page.costEstimated", { amount: formatCents(data.estimatedCostCents, locale) })}</p>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("page.interestLeft")}</dt>
            <dd className="font-semibold tabular-nums">{formatCents(data.interestLeftCents, locale)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("page.insuranceLeft")}</dt>
            <dd className="font-semibold tabular-nums">{formatCents(data.insuranceLeftCents, locale)}</dd>
          </div>
          <div className="border-border flex justify-between gap-3 border-t pt-2">
            <dt className="font-semibold">{t("page.totalCost")}</dt>
            <dd className="font-bold tabular-nums">
              {data.estimatedCostCents > 0 ? "≈ " : ""}
              {formatCents(data.paidInterestAndInsuranceCents + data.interestLeftCents + data.insuranceLeftCents, locale)}
            </dd>
          </div>
        </dl>
      </HomeSection>

      <div className="flex flex-col gap-2 pb-2">
        <Button type="button" variant="outline" className="h-11" onClick={() => setSheet("correct")}>
          {t("page.correct")}
        </Button>
        <Button type="button" variant="outline" className="h-11" onClick={() => setSheet("simulate")} disabled={data.projectionInput === null || data.owedCents === 0}>
          {t("page.simulate")}
        </Button>
        <Button type="button" variant="outline" className="h-11" onClick={() => setSheet("edit")}>
          {t("page.edit")}
        </Button>
        <Button type="button" variant="ghost" className="text-destructive h-11" onClick={() => setDeleting(true)}>
          {t("page.delete")}
        </Button>
      </div>

      <Sheet open={sheet === "edit"} onOpenChange={(next) => !next && close()}>
        <SheetContent className="theme-50f" title={t("form.editHeading")}>
          <LoanForm
            loan={loan}
            payments={data.payments}
            today={today}
            onSaved={() => {
              close();
              router.refresh();
            }}
          />
        </SheetContent>
      </Sheet>
      <Sheet open={sheet === "correct"} onOpenChange={(next) => !next && close()}>
        <SheetContent className="theme-50f" title={t("correct.heading")}>
          <CorrectionForm loanId={loan.id} today={today} onSaved={close} />
          <ToastViewport inSheet />
        </SheetContent>
      </Sheet>
      <Sheet open={sheet === "simulate"} onOpenChange={(next) => !next && close()}>
        <SheetContent className="theme-50f" title={t("simulate.heading")}>
          <Simulator input={data.projectionInput} />
        </SheetContent>
      </Sheet>
      <Sheet open={splitPayment !== null} onOpenChange={(next) => !next && close()}>
        {splitPayment && payment?.kind === "payment" && (
          <SheetContent className="theme-50f" title={t("split.heading", { date: formatShortDay(payment.date, today, locale) })}>
            <SplitForm key={splitPayment.transactionId} loanId={loan.id} payment={splitPayment} onSaved={close} />
          </SheetContent>
        )}
      </Sheet>

      <AlertDialog open={deleting} onOpenChange={(next) => !pending && setDeleting(next)}>
        <AlertDialogContent className="theme-50f">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("delete.description", { name: loan.name })}</AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("delete.cancel")}</AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={pending} onClick={remove}>
              {pending ? t("delete.pending") : t("delete.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
