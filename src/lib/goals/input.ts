import { z } from "zod";

import { isValidIsoDate } from "../balance/input";
import { parseBudgetAmount } from "../budgets/amount";
import { categoryIconSchema } from "../categorize/icon";

export const GOAL_NAME_MAX_LENGTH = 60;

/** Where a goal's progress comes from: an account id, or money added by hand. */
export type GoalSource = { kind: "account"; accountId: string } | { kind: "manual" };

export interface GoalInput {
  name: string;
  targetCents: number;
  /** "YYYY-MM-DD" or null. */
  targetDate: string | null;
  icon: string | null;
  source: GoalSource;
}

export type GoalFormError =
  | "nameRequired"
  | "nameTooLong"
  | "targetRequired"
  | "targetInvalid"
  | "targetNotPositive"
  | "targetTooLarge"
  | "dateInvalid"
  | "datePast"
  | "iconInvalid"
  | "sourceInvalid";

export type GoalFormResult = { ok: true; value: GoalInput } | { ok: false; error: GoalFormError };

const nameSchema = z.string().trim().min(1, "nameRequired").max(GOAL_NAME_MAX_LENGTH, "nameTooLong");
const sourceSchema = z.union([z.literal("manual"), z.uuid()]);

/**
 * Validates the goal form's raw fields. A date before today is refused, except when it is
 * the goal's current date (`previousDate`), so an overdue goal can still be renamed.
 * Returns codes, never text.
 */
export function parseGoalForm(
  fields: { name: unknown; target: unknown; date: unknown; icon: unknown; source: unknown },
  context: { today: string; previousDate?: string | null },
): GoalFormResult {
  const name = nameSchema.safeParse(fields.name);
  if (!name.success) return { ok: false, error: name.error.issues[0]?.message === "nameTooLong" ? "nameTooLong" : "nameRequired" };

  const targetText = typeof fields.target === "string" ? fields.target.slice(0, 40) : "";
  const target = parseBudgetAmount(targetText);
  if (!target.ok) {
    const error = ({ invalid: "targetInvalid", not_positive: "targetNotPositive", too_large: "targetTooLarge" } as const)[target.error];
    return { ok: false, error };
  }
  if (target.cents === null) return { ok: false, error: "targetRequired" };

  const dateText = typeof fields.date === "string" ? fields.date.trim() : "";
  let targetDate: string | null = null;
  if (dateText !== "") {
    if (!isValidIsoDate(dateText)) return { ok: false, error: "dateInvalid" };
    // ISO dates compare as strings.
    if (dateText < context.today && dateText !== context.previousDate) return { ok: false, error: "datePast" };
    targetDate = dateText;
  }

  const icon = categoryIconSchema.safeParse(typeof fields.icon === "string" ? fields.icon : "");
  if (!icon.success) return { ok: false, error: "iconInvalid" };

  const source = sourceSchema.safeParse(fields.source);
  if (!source.success) return { ok: false, error: "sourceInvalid" };

  return {
    ok: true,
    value: {
      name: name.data,
      targetCents: target.cents,
      targetDate,
      icon: icon.data,
      source: source.data === "manual" ? { kind: "manual" } : { kind: "account", accountId: source.data },
    },
  };
}

export type ContributionFormError =
  | "amountRequired"
  | "amountInvalid"
  | "amountNotPositive"
  | "amountTooLarge"
  | "dateInvalid"
  | "dateFuture"
  | "directionInvalid";

export type ContributionFormResult =
  | { ok: true; value: { amountCents: number; date: string } }
  | { ok: false; error: ContributionFormError };

/**
 * Validates "Add money" / "Take out": a positive amount, and a date that isn't in the future.
 * Taking out gives a negative amount.
 */
export function parseContributionForm(
  fields: { amount: unknown; date: unknown; direction: unknown },
  context: { today: string },
): ContributionFormResult {
  const direction = z.enum(["add", "remove"]).safeParse(fields.direction);
  if (!direction.success) return { ok: false, error: "directionInvalid" };

  const amountText = typeof fields.amount === "string" ? fields.amount.slice(0, 40) : "";
  const amount = parseBudgetAmount(amountText);
  if (!amount.ok) {
    const error = ({ invalid: "amountInvalid", not_positive: "amountNotPositive", too_large: "amountTooLarge" } as const)[amount.error];
    return { ok: false, error };
  }
  if (amount.cents === null) return { ok: false, error: "amountRequired" };

  const date = typeof fields.date === "string" ? fields.date.trim() : "";
  if (!isValidIsoDate(date)) return { ok: false, error: "dateInvalid" };
  if (date > context.today) return { ok: false, error: "dateFuture" };

  return { ok: true, value: { amountCents: direction.data === "add" ? amount.cents : -amount.cents, date } };
}
