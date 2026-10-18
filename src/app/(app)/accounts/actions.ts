"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { db } from "@/db/client";
import {
  clearAccountBalance,
  isBankBalanceAccount,
  setAccountBalance,
  setAccountInSafeToSpend,
  setAccountThreshold,
} from "@/db/queries/balance";
import { setAccountImportReminder } from "@/db/queries/import-reminder";
import { createAccount, deleteAccount, renameAccount, setAccountSavings, setHomeAccount, type AccountWriteError } from "@/db/queries/accounts";
import { deleteSavingsRule, restoreSavingsRule } from "@/db/queries/savings";
import { refreshDerivedData } from "@/lib/actions/refresh-derived";
import { withActionErrors } from "@/lib/actions/safe-action";
import { accountNameSchema } from "@/lib/accounts/name";
import { requireUser } from "@/lib/auth/session";
import { isValidIsoDate, parseBalanceAmount, parseThresholdAmount } from "@/lib/balance/input";
import { currentDate } from "@/lib/dashboard/month";
import { addDays } from "@/lib/recurring/dates";

export type AccountFormState = { status: "ok" } | { status: "error"; error: string } | undefined;
export type DeleteAccountState = { status: "ok" } | { status: "error"; error: string };

type Translator = Awaited<ReturnType<typeof getTranslations<"settings">>>;

const ERROR_KEYS = {
  required: "required",
  tooLong: "tooLong",
  nameTaken: "nameTaken",
  notFound: "notFound",
  lastAccount: "lastAccount",
} as const satisfies Record<AccountWriteError | "notFound" | "lastAccount", string>;

function errorMessage(t: Translator, code: keyof typeof ERROR_KEYS): string {
  return t(`accounts.errors.${ERROR_KEYS[code]}`);
}

// Accounts feed every page that lists or filters by account.
function revalidateAll() {
  for (const path of ["/accounts", "/import", "/transactions", "/", "/recurring", "/year"]) {
    revalidatePath(path);
  }
}

function parseName(formData: FormData) {
  return accountNameSchema.safeParse(formData.get("name"));
}

function nameError(t: Translator, issues: readonly { message: string }[]) {
  return { status: "error" as const, error: errorMessage(t, issues[0]?.message === "tooLong" ? "tooLong" : "required") };
}

export async function createAccountAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("accounts.errors.createFailed"), async (): Promise<AccountFormState> => {
    const user = await requireUser();
    const name = parseName(formData);
    if (!name.success) return nameError(t, name.error.issues);

    const result = await createAccount(db, user.id, name.data);
    if (!result.ok) return { status: "error", error: errorMessage(t, result.error) };

    revalidateAll();
    return { status: "ok" };
  });
}

export async function renameAccountAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("accounts.errors.renameFailed"), async (): Promise<AccountFormState> => {
    const user = await requireUser();
    const id = z.uuid().safeParse(formData.get("id"));
    if (!id.success) return { status: "error", error: errorMessage(t, "notFound") };
    const name = parseName(formData);
    if (!name.success) return nameError(t, name.error.issues);

    const result = await renameAccount(db, user.id, id.data, name.data);
    if (!result.ok) return { status: "error", error: errorMessage(t, result.error) };

    revalidateAll();
    return { status: "ok" };
  });
}

export async function deleteAccountAction(accountId: string): Promise<DeleteAccountState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("accounts.errors.deleteFailed"), async (): Promise<DeleteAccountState> => {
    const user = await requireUser();
    const id = z.uuid().safeParse(accountId);
    if (!id.success) return { status: "error", error: errorMessage(t, "notFound") };

    const result = await deleteAccount(db, user.id, id.data);
    if (!result.ok) return { status: "error", error: errorMessage(t, result.error) };

    await refreshDerivedData(user.id, "accountDelete");
    revalidateAll();
    return { status: "ok" };
  });
}

export type BalanceFormState = { status: "ok" } | { status: "error"; error: string } | undefined;

const balanceFormSchema = z.object({
  id: z.uuid(),
  amount: z.string().max(40),
  date: z.string().max(10),
  threshold: z.string().max(40),
});

type BalanceErrorKey =
  | "amountRequired"
  | "amountInvalid"
  | "amountTooLarge"
  | "thresholdInvalid"
  | "thresholdTooLarge"
  | "dateInvalid"
  | "dateFuture"
  | "bankBalance";

function balanceError(t: Translator, code: BalanceErrorKey | "notFound") {
  return { status: "error" as const, error: t(`accounts.errors.${code}`) };
}

export async function setBalanceAction(_prev: BalanceFormState, formData: FormData): Promise<BalanceFormState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("accounts.errors.balanceFailed"), async (): Promise<BalanceFormState> => {
    const user = await requireUser();
    const fields = balanceFormSchema.safeParse({
      id: formData.get("id"),
      amount: formData.get("amount") ?? "",
      date: formData.get("date") ?? "",
      threshold: formData.get("threshold") ?? "",
    });
    if (!fields.success) return balanceError(t, "notFound");
    const { id, amount, date, threshold } = fields.data;

    const parsedAmount = parseBalanceAmount(amount);
    if (!parsedAmount.ok) return balanceError(t, parsedAmount.error === "too_large" ? "amountTooLarge" : "amountInvalid");
    if (parsedAmount.cents === null) return balanceError(t, "amountRequired");

    const parsedThreshold = parseThresholdAmount(threshold);
    if (!parsedThreshold.ok) return balanceError(t, parsedThreshold.error === "too_large" ? "thresholdTooLarge" : "thresholdInvalid");

    if (!isValidIsoDate(date)) return balanceError(t, "dateInvalid");
    // ISO dates compare as strings. Today is in the user's zone, not the server's. Tomorrow is
    // allowed: a balance restored from the bank is the one at the end of the bank's day, so the
    // balance at the start of the day after it.
    if (date > addDays(currentDate(new Date()), 1)) return balanceError(t, "dateFuture");

    // The bank's figure can't be overwritten by hand; only the threshold stays editable (setThresholdAction).
    if (await isBankBalanceAccount(db, user.id, id)) return balanceError(t, "bankBalance");

    const result = await setAccountBalance(db, user.id, id, {
      startingBalanceCents: parsedAmount.cents,
      startingBalanceDate: date,
      thresholdCents: parsedThreshold.cents,
    });
    if (!result.ok) return balanceError(t, "notFound");

    revalidateAll();
    return { status: "ok" };
  });
}

export async function clearBalanceAction(accountId: string): Promise<DeleteAccountState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("accounts.errors.balanceRemoveFailed"), async (): Promise<DeleteAccountState> => {
    const user = await requireUser();
    const id = z.uuid().safeParse(accountId);
    if (!id.success) return balanceError(t, "notFound");

    if (await isBankBalanceAccount(db, user.id, id.data)) return balanceError(t, "bankBalance");

    const result = await clearAccountBalance(db, user.id, id.data);
    if (!result.ok) return balanceError(t, "notFound");

    revalidateAll();
    return { status: "ok" };
  });
}

const thresholdFormSchema = z.object({ id: z.uuid(), threshold: z.string().max(40) });

/** "Warn me below" alone, for an account whose balance comes from the bank. */
export async function setThresholdAction(_prev: BalanceFormState, formData: FormData): Promise<BalanceFormState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("accounts.errors.balanceFailed"), async (): Promise<BalanceFormState> => {
    const user = await requireUser();
    const fields = thresholdFormSchema.safeParse({ id: formData.get("id"), threshold: formData.get("threshold") ?? "" });
    if (!fields.success) return balanceError(t, "notFound");

    const parsed = parseThresholdAmount(fields.data.threshold);
    if (!parsed.ok) return balanceError(t, parsed.error === "too_large" ? "thresholdTooLarge" : "thresholdInvalid");

    const result = await setAccountThreshold(db, user.id, fields.data.id, parsed.cents);
    if (!result.ok) return balanceError(t, "notFound");

    revalidateAll();
    return { status: "ok" };
  });
}

const safeToSpendSchema = z.object({ accountId: z.uuid(), enabled: z.boolean() });

export async function setInSafeToSpendAction(accountId: string, enabled: boolean): Promise<DeleteAccountState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("accounts.errors.safeToSpendFailed"), async (): Promise<DeleteAccountState> => {
    const user = await requireUser();
    const input = safeToSpendSchema.safeParse({ accountId, enabled });
    if (!input.success) return balanceError(t, "notFound");

    const result = await setAccountInSafeToSpend(db, user.id, input.data.accountId, input.data.enabled);
    if (!result.ok) return balanceError(t, "notFound");

    revalidateAll();
    return { status: "ok" };
  });
}

const importReminderSchema = z.object({ accountId: z.uuid(), enabled: z.boolean() });

export async function setImportReminderAction(accountId: string, enabled: boolean): Promise<DeleteAccountState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("accounts.errors.safeToSpendFailed"), async (): Promise<DeleteAccountState> => {
    const user = await requireUser();
    const input = importReminderSchema.safeParse({ accountId, enabled });
    if (!input.success) return balanceError(t, "notFound");

    const ok = await setAccountImportReminder(db, user.id, input.data.accountId, input.data.enabled);
    if (!ok) return balanceError(t, "notFound");

    revalidateAll();
    return { status: "ok" };
  });
}

const homeAccountSchema = z.object({ accountId: z.uuid().nullable() });

export async function setHomeAccountAction(accountId: string | null): Promise<DeleteAccountState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("accounts.errors.homeAccountFailed"), async (): Promise<DeleteAccountState> => {
    const user = await requireUser();
    const input = homeAccountSchema.safeParse({ accountId });
    if (!input.success) return balanceError(t, "notFound");
    if (!(await setHomeAccount(user.id, input.data.accountId))) return balanceError(t, "notFound");
    revalidateAll();
    return { status: "ok" };
  });
}

const accountSavingsSchema = z.object({ accountId: z.uuid(), savings: z.boolean() });

/** Switches an account between Current and Savings (see `setAccountSavings` for what is refused). */
export async function setAccountSavingsAction(accountId: string, savings: boolean): Promise<DeleteAccountState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("accounts.type.errors.failed"), async (): Promise<DeleteAccountState> => {
    const user = await requireUser();
    const input = accountSavingsSchema.safeParse({ accountId, savings });
    if (!input.success) return balanceError(t, "notFound");
    const result = await setAccountSavings(db, user.id, input.data.accountId, input.data.savings);
    if (!result.ok) {
      return { status: "error", error: t(`accounts.type.errors.${result.error === "notFound" ? "notFound" : result.error}`) };
    }
    revalidateAll();
    return { status: "ok" };
  });
}

const savingsRuleIdSchema = z.object({ ruleId: z.uuid() });

/** Removes a savings rule; the moves it already made stay. Returns what Undo needs to put it back. */
export async function deleteSavingsRuleAction(
  ruleId: string,
): Promise<{ status: "ok"; accountId: string; pattern: string; goalId: string | null } | { status: "error"; error: string }> {
  const t = await getTranslations("settings");
  return withActionErrors(t("accounts.type.errors.failed"), async () => {
    const user = await requireUser();
    const input = savingsRuleIdSchema.safeParse({ ruleId });
    if (!input.success) return balanceError(t, "notFound");
    const rule = await deleteSavingsRule(db, user.id, input.data.ruleId);
    if (!rule) return balanceError(t, "notFound");
    revalidateAll();
    return { status: "ok" as const, accountId: rule.accountId, pattern: rule.pattern, goalId: rule.goalId };
  });
}

const restoreRuleSchema = z.object({ accountId: z.uuid(), pattern: z.string().trim().min(1).max(200), goalId: z.uuid().nullable() });

export async function restoreSavingsRuleAction(accountId: string, pattern: string, goalId: string | null): Promise<DeleteAccountState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("accounts.type.errors.failed"), async (): Promise<DeleteAccountState> => {
    const user = await requireUser();
    const input = restoreRuleSchema.safeParse({ accountId, pattern, goalId });
    if (!input.success || !(await restoreSavingsRule(db, user.id, input.data))) return balanceError(t, "notFound");
    revalidateAll();
    return { status: "ok" };
  });
}
