"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { db } from "@/db/client";
import {
  addLoanCorrection,
  clearLoanPaymentSplit,
  createLoan,
  deleteLoan,
  deleteLoanCorrection,
  restoreLoan,
  setLoanPaymentSplit,
  updateLoan,
  type LoanSnapshot,
  type LoanWriteError,
} from "@/db/queries/loans";
import { withActionErrors } from "@/lib/actions/safe-action";
import { requireUser } from "@/lib/auth/session";
import { currentDate } from "@/lib/dashboard/month";
import { loanCorrectionSchema, loanFormSchema, loanSplitSchema, type LoanFormError } from "@/lib/loans/input";
import { addDays } from "@/lib/recurring/dates";

export type LoanFormState = { status: "ok"; loanId?: string } | { status: "error"; error: string } | undefined;
export type LoanActionState = { status: "ok" } | { status: "error"; error: string };
export type DeleteLoanState = { status: "ok"; snapshot: LoanSnapshot } | { status: "error"; error: string };

type Translator = Awaited<ReturnType<typeof getTranslations<"settings">>>;
type ErrorCode = LoanFormError | LoanWriteError | "invalid";

function fail(t: Translator, code: ErrorCode) {
  return { status: "error" as const, error: t(`loans.errors.${code}`) };
}

// Loans show on Comptes and their own page only: no other page ever reads them.
function revalidateLoans(loanId?: string) {
  revalidatePath("/accounts");
  if (loanId) revalidatePath(`/accounts/loans/${loanId}`);
}

const FORM_FIELDS = ["name", "borrowed", "owed", "owedOn", "rate", "insuranceMode", "insurance", "lastPaymentOn", "currentPaymentUntil", "startedOn", "amortizationFrom", "recurringId"] as const;

function formInput(formData: FormData) {
  return Object.fromEntries(FORM_FIELDS.map((key) => [key, String(formData.get(key) ?? "")]));
}

function tomorrow() {
  return addDays(currentDate(new Date()), 1);
}

function firstFormError(issues: readonly { message: string }[]): ErrorCode {
  const code = issues[0]?.message;
  return code && code !== "Invalid input" && !code.startsWith("Invalid") ? (code as ErrorCode) : "invalid";
}

export async function createLoanAction(_prev: LoanFormState, formData: FormData): Promise<LoanFormState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("loans.errors.saveFailed"), async (): Promise<LoanFormState> => {
    const user = await requireUser();
    const parsed = loanFormSchema(tomorrow()).safeParse(formInput(formData));
    if (!parsed.success) return fail(t, firstFormError(parsed.error.issues));

    const result = await createLoan(db, user.id, parsed.data);
    if (!result.ok) return fail(t, result.error);
    revalidateLoans();
    return { status: "ok", loanId: result.loanId };
  });
}

export async function updateLoanAction(_prev: LoanFormState, formData: FormData): Promise<LoanFormState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("loans.errors.saveFailed"), async (): Promise<LoanFormState> => {
    const user = await requireUser();
    const id = z.uuid().safeParse(formData.get("id"));
    if (!id.success) return fail(t, "notFound");
    const parsed = loanFormSchema(tomorrow()).safeParse(formInput(formData));
    if (!parsed.success) return fail(t, firstFormError(parsed.error.issues));

    const result = await updateLoan(db, user.id, id.data, parsed.data);
    if (!result.ok) return fail(t, result.error);
    revalidateLoans(id.data);
    return { status: "ok", loanId: id.data };
  });
}

/** Returns the snapshot so the toast's Undo can put the loan back (`restoreLoanAction`). */
export async function deleteLoanAction(loanId: string): Promise<DeleteLoanState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("loans.errors.deleteFailed"), async (): Promise<DeleteLoanState> => {
    const user = await requireUser();
    const id = z.uuid().safeParse(loanId);
    if (!id.success) return fail(t, "notFound");
    const snapshot = await deleteLoan(db, user.id, id.data);
    if (!snapshot) return fail(t, "notFound");
    revalidateLoans(id.data);
    return { status: "ok", snapshot };
  });
}

export async function restoreLoanAction(snapshot: LoanSnapshot): Promise<LoanActionState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("loans.errors.saveFailed"), async (): Promise<LoanActionState> => {
    const user = await requireUser();
    // The snapshot comes back from the browser: re-parse it so only well-formed values reach the DB.
    const parsed = snapshotSchema.safeParse(snapshot);
    if (!parsed.success) return fail(t, "invalid");
    const result = await restoreLoan(db, user.id, parsed.data as LoanSnapshot);
    if (!result.ok) return fail(t, result.error);
    revalidateLoans(parsed.data.loan.id);
    return { status: "ok" };
  });
}

const snapshotSchema = z.object({
  loan: z.object({
    id: z.uuid(),
    userId: z.string(),
    name: z.string().min(1).max(100),
    borrowedCents: z.number().int(),
    rateThousandths: z.number().int(),
    insuranceCents: z.number().int().nullable(),
    insuranceRateThousandths: z.number().int().nullable(),
    lastPaymentOn: z.string(),
    currentPaymentUntil: z.string().nullable(),
    startedOn: z.string().nullable(),
    amortizationFrom: z.string().nullable(),
    recurringId: z.uuid().nullable(),
    createdAt: z.coerce.date(),
  }),
  checkpoints: z.array(z.object({ id: z.uuid(), date: z.string(), owedCents: z.number().int() })),
  splits: z.array(z.object({ transactionId: z.uuid(), interestCents: z.number().int(), insuranceCents: z.number().int() })),
});

const correctionFormSchema = z.object({ id: z.uuid(), owed: z.string().max(40), owedOn: z.string().max(10) });

export async function addLoanCorrectionAction(_prev: LoanFormState, formData: FormData): Promise<LoanFormState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("loans.errors.saveFailed"), async (): Promise<LoanFormState> => {
    const user = await requireUser();
    const fields = correctionFormSchema.safeParse({
      id: formData.get("id"),
      owed: String(formData.get("owed") ?? ""),
      owedOn: String(formData.get("owedOn") ?? ""),
    });
    if (!fields.success) return fail(t, "notFound");
    const parsed = loanCorrectionSchema(tomorrow()).safeParse(fields.data);
    if (!parsed.success) return fail(t, firstFormError(parsed.error.issues));

    const result = await addLoanCorrection(db, user.id, fields.data.id, { date: parsed.data.owedOn, owedCents: parsed.data.owed });
    if (!result.ok) return fail(t, result.error);
    revalidateLoans(fields.data.id);
    return { status: "ok", loanId: fields.data.id };
  });
}

const checkpointSchema = z.object({ loanId: z.uuid(), checkpointId: z.uuid() });

export async function deleteLoanCorrectionAction(loanId: string, checkpointId: string): Promise<LoanActionState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("loans.errors.saveFailed"), async (): Promise<LoanActionState> => {
    const user = await requireUser();
    const input = checkpointSchema.safeParse({ loanId, checkpointId });
    if (!input.success) return fail(t, "notFound");
    const result = await deleteLoanCorrection(db, user.id, input.data.checkpointId);
    if (!result.ok) return fail(t, result.error);
    revalidateLoans(input.data.loanId);
    return { status: "ok" };
  });
}

const splitFormSchema = z.object({ loanId: z.uuid(), transactionId: z.uuid(), interest: z.string().max(40), insurance: z.string().max(40) });

export async function setLoanPaymentSplitAction(_prev: LoanFormState, formData: FormData): Promise<LoanFormState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("loans.errors.saveFailed"), async (): Promise<LoanFormState> => {
    const user = await requireUser();
    const fields = splitFormSchema.safeParse({
      loanId: formData.get("loanId"),
      transactionId: formData.get("transactionId"),
      interest: String(formData.get("interest") ?? ""),
      insurance: String(formData.get("insurance") ?? ""),
    });
    if (!fields.success) return fail(t, "notFound");
    const parsed = loanSplitSchema.safeParse(fields.data);
    if (!parsed.success) return fail(t, "amountInvalid");

    const result = await setLoanPaymentSplit(db, user.id, fields.data.loanId, fields.data.transactionId, {
      interestCents: parsed.data.interest,
      insuranceCents: parsed.data.insurance,
    });
    if (!result.ok) return fail(t, result.error);
    revalidateLoans(fields.data.loanId);
    return { status: "ok", loanId: fields.data.loanId };
  });
}

const paymentSchema = z.object({ loanId: z.uuid(), transactionId: z.uuid() });

export async function clearLoanPaymentSplitAction(loanId: string, transactionId: string): Promise<LoanActionState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("loans.errors.saveFailed"), async (): Promise<LoanActionState> => {
    const user = await requireUser();
    const input = paymentSchema.safeParse({ loanId, transactionId });
    if (!input.success) return fail(t, "notFound");
    await clearLoanPaymentSplit(db, user.id, input.data.loanId, input.data.transactionId);
    revalidateLoans(input.data.loanId);
    return { status: "ok" };
  });
}
