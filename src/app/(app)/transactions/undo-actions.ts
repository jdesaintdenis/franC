"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db/client";
import { undoRule } from "@/db/queries/category-rules";
import { restoreTransactionCategory, type CategoryDisplay } from "@/db/queries/transactions";
import { requireUser } from "@/lib/auth/session";

/** Codes, not copy: the sheet translates them. */
export type UndoErrorCode = "invalidInput" | "notFound" | "categoryNotFound";

export type RestoreCategoryResult =
  | {
      status: "done";
      category: CategoryDisplay | null;
      categorySource: "manual" | "rule" | "bank" | "guess" | null;
    }
  | { status: "error"; error: UndoErrorCode };

const restoreInput = z.object({
  transactionId: z.uuid(),
  categoryId: z.uuid().nullable(),
  categorySource: z.enum(["manual", "rule", "bank", "guess"]).nullable(),
  reviewed: z.boolean(),
});

function revalidateAfterUndo(): void {
  revalidatePath("/transactions");
  // The nav counter and the dashboard follow the category and review state.
  revalidatePath("/", "layout");
}

/** Undo for a category change: puts back the previous category, its source and review state. */
export async function restoreCategoryAction(input: unknown): Promise<RestoreCategoryResult> {
  const user = await requireUser();
  const parsed = restoreInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };
  const { transactionId, categoryId, categorySource, reviewed } = parsed.data;

  const result = await restoreTransactionCategory(db, user.id, transactionId, { categoryId, categorySource, reviewed });
  if (!result) return { status: "error", error: categoryId ? "categoryNotFound" : "notFound" };
  revalidateAfterUndo();
  return { status: "done", category: result.category, categorySource: result.categorySource };
}

export type UndoRuleResult =
  | {
      status: "done";
      /** The rows whose category was cleared (those still set by the rule). */
      cleared: string[];
    }
  | { status: "error"; error: UndoErrorCode };

const undoRuleInput = z.object({
  ruleId: z.uuid(),
  transactionIds: z.array(z.uuid()).max(500),
});

/** Undo for "Create rule": deletes the rule and un-categorizes the rows it categorized, if untouched since. */
export async function undoRuleAction(input: unknown): Promise<UndoRuleResult> {
  const user = await requireUser();
  const parsed = undoRuleInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const result = await undoRule(db, user.id, parsed.data.ruleId, [...new Set(parsed.data.transactionIds)]);
  if (!result) return { status: "error", error: "notFound" };
  revalidateAfterUndo();
  revalidatePath("/settings/rules");
  return { status: "done", cleared: result.cleared };
}
