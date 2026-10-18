"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { db } from "@/db/client";
import {
  addContribution,
  assignToGoal,
  createGoal,
  deleteContribution,
  deleteGoal,
  getGoalAccountId,
  getGoalTargetDate,
  moveBetweenGoals,
  restoreGoal,
  updateGoal,
} from "@/db/queries/goals";
import { withActionErrors } from "@/lib/actions/safe-action";
import { requireUser } from "@/lib/auth/session";
import { currentDate } from "@/lib/dashboard/month";
import { parseContributionForm, parseGoalForm } from "@/lib/goals/input";
import { goalSnapshotSchema, type GoalSnapshot } from "@/lib/goals/snapshot";

export type GoalFormState = { status: "ok" } | { status: "error"; error: string } | undefined;
export type GoalActionState = { status: "ok" } | { status: "error"; error: string };
/** Delete hands back what Undo sends to `restoreGoalAction`. */
export type GoalDeleteState = { status: "ok"; snapshot: GoalSnapshot } | { status: "error"; error: string };

const idSchema = z.uuid();

function revalidateGoals() {
  revalidatePath("/settings/goals");
  revalidatePath("/accounts");
  revalidatePath("/budget");
  revalidatePath("/");
}

/** Creates a goal, or updates it when the form carries an `id`. */
export async function saveGoalAction(_prev: GoalFormState, formData: FormData): Promise<GoalFormState> {
  const t = await getTranslations("settings.goals");
  return withActionErrors(t("errors.saveFailed"), async (): Promise<GoalFormState> => {
    const user = await requireUser();
    const today = currentDate(new Date());

    const rawId = formData.get("id");
    const id = rawId === null ? null : idSchema.safeParse(rawId);
    if (id && !id.success) return { status: "error", error: t("errors.notFound") };

    // Editing may keep a date that has since passed, so a late goal can still be renamed.
    let previousDate: string | null = null;
    if (id?.success) {
      const current = await getGoalTargetDate(db, user.id, id.data);
      if (!current) return { status: "error", error: t("errors.notFound") };
      previousDate = current.targetDate;
    }

    const parsed = parseGoalForm(
      {
        name: formData.get("name"),
        target: formData.get("target"),
        date: formData.get("date"),
        icon: formData.get("icon") ?? "",
        source: formData.get("source"),
      },
      { today, previousDate },
    );
    if (!parsed.ok) return { status: "error", error: t(`errors.${parsed.error}`) };

    const result = id?.success
      ? await updateGoal(db, user.id, id.data, parsed.value, today)
      : await createGoal(db, user.id, parsed.value, today);
    if (!result.ok) return { status: "error", error: t(`errors.${result.error}`) };

    revalidateGoals();
    return { status: "ok" };
  });
}

export async function deleteGoalAction(goalId: string): Promise<GoalDeleteState> {
  const t = await getTranslations("settings.goals");
  return withActionErrors(t("errors.deleteFailed"), async (): Promise<GoalDeleteState> => {
    const user = await requireUser();
    const id = idSchema.safeParse(goalId);
    if (!id.success) return { status: "error", error: t("errors.notFound") };

    const result = await deleteGoal(db, user.id, id.data);
    if (!result.ok) return { status: "error", error: t(`errors.${result.error}`) };

    revalidateGoals();
    return { status: "ok", snapshot: result.snapshot };
  });
}

/** Undo of a delete: the snapshot comes from the client, so it is validated here. */
export async function restoreGoalAction(snapshot: unknown): Promise<GoalActionState> {
  const t = await getTranslations("settings.goals");
  return withActionErrors(t("errors.restoreFailed"), async (): Promise<GoalActionState> => {
    const user = await requireUser();
    const parsed = goalSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) return { status: "error", error: t("errors.restoreFailed") };

    const result = await restoreGoal(db, user.id, parsed.data);
    if (!result.ok) return { status: "error", error: t(`errors.${result.error}`) };

    revalidateGoals();
    return { status: "ok" };
  });
}

/**
 * "Add money" / "Take out" on a goal tracked by hand, "Assign" / "Unassign" on a goal kept in an account:
 * the submit button's `direction` value says which way.
 */
export async function addContributionAction(_prev: GoalFormState, formData: FormData): Promise<GoalFormState> {
  const t = await getTranslations("settings.goals");
  return withActionErrors(t("errors.contributionFailed"), async (): Promise<GoalFormState> => {
    const user = await requireUser();
    const id = idSchema.safeParse(formData.get("goalId"));
    if (!id.success) return { status: "error", error: t("errors.notFound") };

    const parsed = parseContributionForm(
      { amount: formData.get("amount"), date: formData.get("date"), direction: formData.get("direction") },
      { today: currentDate(new Date()) },
    );
    if (!parsed.ok) return { status: "error", error: t(`errors.${parsed.error}`) };

    const accountId = await getGoalAccountId(db, user.id, id.data);
    if (accountId === undefined) return { status: "error", error: t("errors.notFound") };
    const result =
      accountId === null
        ? await addContribution(db, user.id, id.data, parsed.value)
        : await assignToGoal(db, user.id, id.data, parsed.value);
    if (!result.ok) return { status: "error", error: t(`errors.${result.error}`) };

    revalidateGoals();
    return { status: "ok" };
  });
}

export async function deleteContributionAction(contributionId: string): Promise<GoalActionState> {
  const t = await getTranslations("settings.goals");
  return withActionErrors(t("errors.removeFailed"), async (): Promise<GoalActionState> => {
    const user = await requireUser();
    const id = idSchema.safeParse(contributionId);
    if (!id.success) return { status: "error", error: t("errors.notFound") };

    const result = await deleteContribution(db, user.id, id.data);
    if (!result.ok) return { status: "error", error: t(`errors.${result.error}`) };

    revalidateGoals();
    return { status: "ok" };
  });
}

/** Moves assigned money from one goal to another goal of the same account. */
export async function moveBetweenGoalsAction(_prev: GoalFormState, formData: FormData): Promise<GoalFormState> {
  const t = await getTranslations("settings.goals");
  return withActionErrors(t("errors.contributionFailed"), async (): Promise<GoalFormState> => {
    const user = await requireUser();
    const from = idSchema.safeParse(formData.get("fromGoalId"));
    const to = idSchema.safeParse(formData.get("toGoalId"));
    if (!from.success || !to.success) return { status: "error", error: t("errors.notFound") };

    const parsed = parseContributionForm(
      { amount: formData.get("amount"), date: formData.get("date"), direction: "add" },
      { today: currentDate(new Date()) },
    );
    if (!parsed.ok) return { status: "error", error: t(`errors.${parsed.error}`) };

    const result = await moveBetweenGoals(db, user.id, { fromGoalId: from.data, toGoalId: to.data, ...parsed.value });
    if (!result.ok) return { status: "error", error: t(`errors.${result.error}`) };

    revalidateGoals();
    return { status: "ok" };
  });
}
