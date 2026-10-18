"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { db } from "@/db/client";
import { removeBudget, restoreBudget, setBudget } from "@/db/queries/budgets";
import { withActionErrors } from "@/lib/actions/safe-action";
import { requireUser } from "@/lib/auth/session";
import { parseBudgetAmount, type BudgetAmountError } from "@/lib/budgets/amount";
import type { BudgetSnapshot } from "@/lib/budgets/snapshot";

export type BudgetFormState =
  | { status: "ok"; saved: "set" | "removed"; carryReset?: boolean }
  | { status: "error"; error: string }
  | undefined;

const inputSchema = z.object({
  categoryId: z.uuid(),
  // Bounded before parsing: the parser is linear but there is no reason to accept a novel.
  amount: z.string().max(40),
  // An unchecked checkbox sends nothing; a checked one sends "on".
  rollover: z.literal("on").nullable(),
});

const ERROR_KEYS = {
  invalid: "invalid",
  not_positive: "notPositive",
  too_large: "tooLarge",
} as const satisfies Record<BudgetAmountError, string>;

export async function saveBudgetAction(_prev: BudgetFormState, formData: FormData): Promise<BudgetFormState> {
  const t = await getTranslations("settings.budgets");
  return withActionErrors(t("errors.saveFailed"), async (): Promise<BudgetFormState> => {
    const user = await requireUser();
    const input = inputSchema.safeParse({
      categoryId: formData.get("categoryId"),
      amount: formData.get("amount") ?? "",
      rollover: formData.get("rollover"),
    });
    if (!input.success) {
      const idProblem = input.error.issues.some((i) => i.path[0] === "categoryId");
      return { status: "error", error: t(idProblem ? "errors.notFound" : "errors.invalid") };
    }

    const amount = parseBudgetAmount(input.data.amount);
    if (!amount.ok) return { status: "error", error: t(`errors.${ERROR_KEYS[amount.error]}`) };

    let carryReset = false;
    if (amount.cents === null) {
      await removeBudget(db, user.id, input.data.categoryId);
    } else {
      const result = await setBudget(db, user.id, input.data.categoryId, amount.cents, {
        rollover: input.data.rollover === "on",
      });
      if (!result.ok) return { status: "error", error: t("errors.notFound") };
      carryReset = result.carryReset === true;
    }

    revalidatePath("/settings/budgets");
    revalidatePath("/");
    return { status: "ok", saved: amount.cents === null ? "removed" : "set", carryReset };
  });
}

export type RemoveBudgetState = { status: "ok"; snapshot: BudgetSnapshot | null } | { status: "error"; error: string };

/** Removes a budget and hands back the row, so the toast's Undo can restore it exactly. */
export async function removeBudgetAction(categoryId: string): Promise<RemoveBudgetState> {
  const t = await getTranslations("settings.budgets");
  return withActionErrors(t("errors.removeFailed"), async (): Promise<RemoveBudgetState> => {
    const user = await requireUser();
    const id = z.uuid().safeParse(categoryId);
    if (!id.success) return { status: "error", error: t("errors.notFound") };
    const snapshot = await removeBudget(db, user.id, id.data);
    revalidatePath("/settings/budgets");
    revalidatePath("/");
    return { status: "ok", snapshot };
  });
}

export type RestoreBudgetState = { status: "ok" } | { status: "error"; error: string };

/** Undo of a removal. The snapshot comes from the client: restoreBudget validates it. */
export async function restoreBudgetAction(snapshot: unknown): Promise<RestoreBudgetState> {
  const t = await getTranslations("settings.budgets");
  return withActionErrors(t("errors.restoreFailed"), async (): Promise<RestoreBudgetState> => {
    const user = await requireUser();
    const result = await restoreBudget(db, user.id, snapshot);
    if (!result.ok) return { status: "error", error: t(result.error === "not_found" ? "errors.notFound" : "errors.restoreFailed") };
    revalidatePath("/settings/budgets");
    revalidatePath("/");
    return { status: "ok" };
  });
}
