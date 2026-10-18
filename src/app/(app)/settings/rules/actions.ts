"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { db } from "@/db/client";
import {
  applyRulesToUncategorized,
  createRule,
  deleteRule,
  reorderRules,
  restoreRule,
  type RuleSnapshot,
  updateRule,
} from "@/db/queries/category-rules";
import { dismissRuleSuggestion } from "@/db/queries/guess";
import { requireUser } from "@/lib/auth/session";
import { withActionErrors } from "@/lib/actions/safe-action";
import { MAX_PATTERN, ruleInput } from "@/lib/categorize/schemas";

import { validationMessage } from "../validation-errors";

/** `categorized` is only set when rules were applied to existing transactions. */
export type RuleFormState =
  | { status: "ok"; categorized?: number }
  | { status: "error"; error: string }
  | undefined;

type Translator = Awaited<ReturnType<typeof getTranslations<"settings">>>;

function invalidInput(t: Translator, issues: readonly { message: string }[]): RuleFormState {
  return { status: "error", error: validationMessage(t, issues, t("validation.invalidRule")) };
}

function revalidateAll() {
  revalidatePath("/settings/rules");
  revalidatePath("/settings/categories");
  revalidatePath("/transactions");
}

function parseInput(formData: FormData) {
  return ruleInput.safeParse({
    categoryId: formData.get("categoryId"),
    matchType: formData.get("matchType"),
    pattern: formData.get("pattern"),
  });
}

async function applyIfRequested(userId: string, formData: FormData): Promise<number | undefined> {
  if (formData.get("apply") !== "on") return undefined;
  return (await applyRulesToUncategorized(db, userId)).updated;
}

export async function createRuleAction(_prev: RuleFormState, formData: FormData): Promise<RuleFormState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("rules.form.addError"), () => createRuleImpl(t, formData));
}

async function createRuleImpl(t: Translator, formData: FormData): Promise<RuleFormState> {
  const user = await requireUser();
  const parsed = parseInput(formData);
  if (!parsed.success) return invalidInput(t, parsed.error.issues);

  const rule = await createRule(db, user.id, parsed.data);
  if (!rule) return { status: "error", error: t("rules.errors.notFound") };

  const categorized = await applyIfRequested(user.id, formData);
  revalidateAll();
  return { status: "ok", categorized };
}

export async function updateRuleAction(_prev: RuleFormState, formData: FormData): Promise<RuleFormState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("rules.form.saveError"), () => updateRuleImpl(t, formData));
}

async function updateRuleImpl(t: Translator, formData: FormData): Promise<RuleFormState> {
  const user = await requireUser();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { status: "error", error: t("rules.errors.notFound") };
  const parsed = parseInput(formData);
  if (!parsed.success) return invalidInput(t, parsed.error.issues);

  const rule = await updateRule(db, user.id, id.data, parsed.data);
  if (!rule) return { status: "error", error: t("rules.errors.notFound") };

  const categorized = await applyIfRequested(user.id, formData);
  revalidateAll();
  return { status: "ok", categorized };
}

export type DeleteRuleResult =
  | { status: "ok"; snapshot: RuleSnapshot }
  | { status: "error"; error: string };

/** Returns the snapshot the client hands back to `restoreRuleAction` if the user taps Undo. */
export async function deleteRuleAction(ruleId: string): Promise<DeleteRuleResult> {
  const user = await requireUser();
  const t = await getTranslations("settings");
  const id = z.uuid().safeParse(ruleId);
  if (!id.success) return { status: "error", error: t("rules.errors.notFound") };
  const snapshot = await deleteRule(db, user.id, id.data);
  if (!snapshot) return { status: "error", error: t("rules.errors.notFound") };

  revalidateAll();
  return { status: "ok", snapshot };
}

/** Everything comes from the client, so the snapshot is validated like a form. */
const snapshotSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  matchType: z.enum(["contains", "equals", "regex"]),
  pattern: z.string().trim().min(1).max(MAX_PATTERN),
  priority: z.number().int().min(0).max(1_000_000),
});

/** Undo of a delete: the rule comes back with its id, at its place in the order. */
export async function restoreRuleAction(snapshot: unknown): Promise<{ status: "ok" } | { status: "error"; error: string }> {
  const t = await getTranslations("settings");
  return withActionErrors(t("manage.undoFailed"), async (): Promise<{ status: "ok" } | { status: "error"; error: string }> => {
    const user = await requireUser();
    const parsed = snapshotSchema.safeParse(snapshot);
    if (!parsed.success) return { status: "error", error: t("manage.undoFailed") };
    const result = await restoreRule(db, user.id, parsed.data);
    if (!result.ok) return { status: "error", error: t("rules.errors.cannotRestore") };
    revalidateAll();
    return { status: "ok" };
  });
}

export async function reorderRulesAction(
  orderedIds: string[],
): Promise<{ status: "ok" } | { status: "error"; error: string }> {
  const user = await requireUser();
  const t = await getTranslations("settings");
  const ids = z.array(z.uuid()).safeParse(orderedIds);
  if (!ids.success) return { status: "error", error: t("rules.errors.reorderFailed") };
  if (!(await reorderRules(db, user.id, ids.data))) {
    return { status: "error", error: t("rules.errors.listChanged") };
  }

  revalidateAll();
  return { status: "ok" };
}

export async function applyRulesAction(): Promise<RuleFormState> {
  const t = await getTranslations("settings");
  return withActionErrors(t("rules.applyError"), async (): Promise<RuleFormState> => {
    const user = await requireUser();
    const { updated } = await applyRulesToUncategorized(db, user.id);
    revalidateAll();
    return { status: "ok", categorized: updated };
  });
}

const suggestionInput = z.object({
  matchType: z.enum(["equals", "contains"]),
  pattern: z.string().trim().min(1).max(200),
  categoryId: z.uuid(),
});

export type SuggestedRuleResult =
  | { status: "ok"; categorized: number; byCategory: Record<string, string[]>; ruleId: string }
  | { status: "error"; error: string };

/** "Create rule" on a suggestion: stores the rule and applies it to existing rows. */
export async function createSuggestedRuleAction(input: unknown): Promise<SuggestedRuleResult> {
  const user = await requireUser();
  const t = await getTranslations("settings");
  const parsed = suggestionInput.safeParse(input);
  const rule = parsed.success ? ruleInput.safeParse(parsed.data) : null;
  if (!rule?.success) return { status: "error", error: t("validation.invalidRule") };

  const created = await createRule(db, user.id, rule.data);
  if (!created) return { status: "error", error: t("rules.errors.notFound") };
  const applied = await applyRulesToUncategorized(db, user.id);
  revalidateAll();
  revalidatePath("/", "layout");
  return { status: "ok", categorized: applied.updated, byCategory: applied.byCategory, ruleId: created.id };
}

/** "Not now" on a suggestion: it does not come back. */
export async function dismissRuleSuggestionAction(
  input: unknown,
): Promise<{ status: "ok" } | { status: "error"; error: string }> {
  const user = await requireUser();
  const t = await getTranslations("settings");
  const parsed = suggestionInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: t("rules.errors.notFound") };
  if (!(await dismissRuleSuggestion(db, user.id, parsed.data))) {
    return { status: "error", error: t("rules.errors.notFound") };
  }
  revalidatePath("/settings/rules");
  return { status: "ok" };
}
