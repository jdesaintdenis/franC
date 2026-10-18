"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db/client";
import {
  acceptGuess,
  guessCategories,
  suggestionForTransaction,
  type GuessCategoriesResult,
  type RuleSuggestionDetails,
} from "@/db/queries/guess";
import { keepBoth, mergeDuplicate } from "@/db/queries/duplicates";
import { countToReviewForImport, countWaitingForCategory, markReviewed, markToReview } from "@/db/queries/review";
import { requireUser } from "@/lib/auth/session";
import { refreshDerivedData } from "@/lib/actions/refresh-derived";

/** Codes, not copy: the review page translates them. */
export type ReviewErrorCode = "invalidInput";

export type MarkReviewedResult =
  | {
      status: "done";
      /** The rows that actually changed (were still to review), to pass to Undo. */
      ids: string[];
      /** Rows of the target still to review that stay in the queue because they have no category. */
      withoutCategory: number;
    }
  | { status: "error"; error: ReviewErrorCode };

export type UndoReviewedResult = { status: "done"; restored: number } | { status: "error"; error: ReviewErrorCode };

export type GuessCategoriesActionResult =
  | ({ status: "done" } & GuessCategoriesResult)
  | { status: "error"; error: ReviewErrorCode };

export type AcceptGuessResult =
  | {
      status: "done";
      category: NonNullable<Awaited<ReturnType<typeof acceptGuess>>>["category"];
      ruleSuggestion?: RuleSuggestionDetails;
    }
  | { status: "error"; error: ReviewErrorCode | "notFound" };

const MAX_IDS = 500;

const idsSchema = z
  .array(z.uuid())
  .min(1)
  .max(MAX_IDS)
  .transform((ids) => [...new Set(ids)]);

const markInput = z.union([
  z.object({ ids: idsSchema }),
  z.object({ importId: z.uuid() }),
  z.object({ all: z.literal(true) }),
]);

// The nav counter lives in the root layout, so every page refreshes.
function revalidateQueue(): void {
  revalidatePath("/", "layout");
}

/** Marks rows as reviewed: some ids, one import's rows, or everything still to review. */
export async function markReviewedAction(input: unknown): Promise<MarkReviewedResult> {
  const user = await requireUser();
  const parsed = markInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const ids = await markReviewed(db, user.id, parsed.data);
  const withoutCategory = await countWaitingForCategory(db, user.id, parsed.data);
  revalidateQueue();
  return { status: "done", ids, withoutCategory };
}

/** Puts rows back in the queue (Undo of a mark). */
export async function undoReviewedAction(input: unknown): Promise<UndoReviewedResult> {
  const user = await requireUser();
  const parsed = z.object({ ids: idsSchema }).safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const restored = await markToReview(db, user.id, parsed.data.ids);
  revalidateQueue();
  return { status: "done", restored };
}

/** "Guess categories": rules, bank mappings, then guesses for every uncategorized row. */
export async function guessCategoriesAction(): Promise<GuessCategoriesActionResult> {
  const user = await requireUser();
  const counts = await guessCategories(db, user.id);
  revalidatePath("/transactions");
  revalidateQueue();
  return { status: "done", ...counts };
}

export type GuessAndReviewResult =
  | {
      status: "done";
      /** The rows marked reviewed (categorized ones of this import), to pass to Undo. */
      reviewedIds: string[];
      /** This import's rows that still have no category and wait in the queue. */
      leftUncategorized: number;
    }
  | { status: "error"; error: ReviewErrorCode };

/**
 * One button after a big import: guess categories, then mark as reviewed only this
 * import's rows that now have one. The rest stay in the queue for a look.
 */
export async function guessAndReviewImportAction(input: unknown): Promise<GuessAndReviewResult> {
  const user = await requireUser();
  const parsed = z.object({ importId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  await guessCategories(db, user.id);
  const reviewedIds = await markReviewed(db, user.id, { importId: parsed.data.importId });
  const leftUncategorized = await countToReviewForImport(db, user.id, parsed.data.importId);
  revalidatePath("/transactions");
  revalidateQueue();
  return { status: "done", reviewedIds, leftUncategorized };
}

/** Accepts a guessed category: it becomes a hand categorization and the row is reviewed. */
export async function acceptGuessAction(input: unknown): Promise<AcceptGuessResult> {
  const user = await requireUser();
  const parsed = z.object({ transactionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const accepted = await acceptGuess(db, user.id, parsed.data.transactionId);
  if (!accepted) return { status: "error", error: "notFound" };
  const ruleSuggestion = (await suggestionForTransaction(db, user.id, parsed.data.transactionId)) ?? undefined;
  revalidatePath("/transactions");
  revalidateQueue();
  return { status: "done", category: accepted.category, ruleSuggestion };
}

export type DuplicateActionResult = { status: "done" } | { status: "error"; error: ReviewErrorCode | "notFound" };

/** "Same transaction": the row is the candidate seen again; its identity moves onto the candidate and the row is deleted. */
export async function mergeDuplicateAction(input: unknown): Promise<DuplicateActionResult> {
  const user = await requireUser();
  const parsed = z.object({ id: z.uuid(), candidateId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const result = await mergeDuplicate(db, user.id, parsed.data.id, parsed.data.candidateId);
  if (!result.ok) return { status: "error", error: result.error };
  // Totals changed (a row is gone): transfers and recurring may too.
  await refreshDerivedData(user.id, "import");
  revalidatePath("/transactions");
  revalidateQueue();
  return { status: "done" };
}

/** "Keep both": the row stays, without its possible-duplicate links. */
export async function keepBothAction(input: unknown): Promise<DuplicateActionResult> {
  const user = await requireUser();
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  if (!(await keepBoth(db, user.id, parsed.data.id))) return { status: "error", error: "notFound" };
  revalidateQueue();
  return { status: "done" };
}
