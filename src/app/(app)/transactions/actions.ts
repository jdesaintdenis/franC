"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getLoanForTransaction } from "@/db/queries/loans";
import { loanView } from "@/lib/loans/view";

import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { merchants, transactions } from "@/db/schema";
import { applyRulesToUncategorized, createRule, loadCompiledRules } from "@/db/queries/category-rules";
import { listCategories } from "@/db/queries/categories";
import { countWaitingForCategory, markReviewed } from "@/db/queries/review";
import {
  acceptGuess,
  categorySuggestionsFor,
  suggestionForTransaction,
  suggestionForTransactions,
  type RuleSuggestionDetails,
} from "@/db/queries/guess";
import {
  confirmTransfer,
  getTransferForTransaction,
  linkTransfer,
  listTransferCandidates,
  unlinkTransfer,
  type TransferCandidate,
  type TransferForTransaction,
} from "@/db/queries/transfers";
import { moveToSavings, removeSavingsMove, setMoveGoal } from "@/db/queries/savings";
import { removeSplit, saveSplit, type SplitPart, type SplitWriteError } from "@/db/queries/splits";
import {
  bulkSetTransactionCategory,
  listTransactions,
  setIgnored,
  setTransactionCategory,
  sumTransactionsByDay,
  type TransactionListItem,
} from "@/db/queries/transactions";
import { proposeRule, type RuleProposal } from "@/lib/categorize/propose-rule";
import { ruleMatchTypeSchema, ruleInput } from "@/lib/categorize/schemas";
import { requireUser } from "@/lib/auth/session";
import { refreshDerivedData, refreshRecurringAfterTransferChange } from "@/lib/actions/refresh-derived";
import { MAX_SPLIT_PARTS, MIN_SPLIT_PARTS } from "@/lib/splits/validate";
import { decodeCursor, encodeCursor, parseTransactionFilters } from "@/lib/transactions/filters";

export interface LoadMoreResult {
  items: TransactionListItem[];
  /** Encoded cursor for the next page, or null at the end of the list. */
  nextCursor: string | null;
  /** Net cents per date of `items`, over every row of that date (a day can span two pages). */
  dayTotals: Record<string, number>;
}

/**
 * Next page of the list. `rawParams` is the page's URL query string; it is
 * re-parsed here because the client is not trusted to send valid filters.
 */
export async function loadMoreTransactions(rawParams: string, cursor: string): Promise<LoadMoreResult> {
  const user = await requireUser();

  const decoded = decodeCursor(String(cursor));
  if (!decoded) return { items: [], nextCursor: null, dayTotals: {} };

  const filters = parseTransactionFilters(Object.fromEntries(new URLSearchParams(String(rawParams))));
  const page = await listTransactions(db, user.id, filters, decoded);
  const dates = [...new Set(page.items.map((i) => i.date))];
  const dayTotals = await sumTransactionsByDay(db, user.id, filters, dates);
  return { items: page.items, nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null, dayTotals };
}

interface CategoryInfo {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  parentName: string | null;
}

/** Codes, not copy: the dialog translates them (`transactions.errors.*`). */
export type CategorizeErrorCode =
  | "pickCategoryForRule"
  | "invalidInput"
  | "invalidRule"
  | "patternRequired"
  | "invalidRegex"
  | "notFound"
  | "categoryNotFound";

export type CategorizeResult =
  | {
      status: "done";
      category: CategoryInfo | null;
      categorySource: "manual" | null;
      /** Transactions newly categorized by rules, per category id (empty without a rule). */
      retro: Record<string, string[]>;
      /** Display info for every category id in `retro`. */
      retroCategories: Record<string, CategoryInfo>;
      /** Set when this hand categorization makes a merchant qualify for a rule. */
      ruleSuggestion?: RuleSuggestionDetails;
      /** The id of the rule created by this call, for Undo. */
      ruleId?: string;
      /** A one-tap rule to offer; only when no rule was created and no `ruleSuggestion` applies. */
      ruleProposal?: RuleProposal;
    }
  | { status: "error"; error: CategorizeErrorCode };

const categorizeInput = z
  .object({
    transactionId: z.uuid(),
    categoryId: z.uuid().nullable(),
    rule: z.object({ matchType: ruleMatchTypeSchema, pattern: z.string() }).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.rule && v.categoryId === null) {
      ctx.addIssue({ code: "custom", path: ["categoryId"], message: "pickCategoryForRule" });
    }
  });

/** Maps the rule schema's failure to a code from the input itself, not from its message text. */
function ruleErrorCode(matchType: string, pattern: string, error: z.ZodError): CategorizeErrorCode {
  if (!error.issues.some((issue) => issue.path[0] === "pattern")) return "invalidRule";
  return matchType === "regex" && pattern.trim() !== "" ? "invalidRegex" : "patternRequired";
}

/** The labels the client does not have (normalized label) are read here, scoped by user_id. */
async function loadRuleProposal(userId: string, transactionId: string, categoryId: string): Promise<RuleProposal | undefined> {
  const [row] = await db
    .select({
      labelNormalized: transactions.labelNormalized,
      labelDisplay: transactions.labelDisplay,
      merchantName: merchants.name,
    })
    .from(transactions)
    .leftJoin(merchants, and(eq(merchants.id, transactions.merchantId), eq(merchants.userId, userId)))
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
    .limit(1);
  if (!row) return undefined;
  const rules = await loadCompiledRules(db, userId);
  return (
    proposeRule(
      { merchantName: row.merchantName, labelNormalized: row.labelNormalized ?? "", labelDisplay: row.labelDisplay, categoryId },
      rules,
    ) ?? undefined
  );
}

/** Sets a transaction's category by hand, optionally creating a rule and applying it retroactively. */
export async function categorizeTransaction(input: unknown): Promise<CategorizeResult> {
  const user = await requireUser();

  const parsed = categorizeInput.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { status: "error", error: message === "pickCategoryForRule" ? message : "invalidInput" };
  }
  const { transactionId, categoryId, rule } = parsed.data;

  let ruleData: z.infer<typeof ruleInput> | null = null;
  if (rule && categoryId) {
    const checked = ruleInput.safeParse({ categoryId, ...rule });
    if (!checked.success) return { status: "error", error: ruleErrorCode(rule.matchType, rule.pattern, checked.error) };
    ruleData = checked.data;
  }

  const result = await setTransactionCategory(db, user.id, transactionId, categoryId);
  if (!result) return { status: "error", error: "notFound" };

  let retro: Record<string, string[]> = {};
  let ruleId: string | undefined;
  const retroCategories: Record<string, CategoryInfo> = {};
  if (ruleData) {
    const created = await createRule(db, user.id, ruleData);
    if (!created) return { status: "error", error: "categoryNotFound" };
    ruleId = created.id;
    retro = (await applyRulesToUncategorized(db, user.id)).byCategory;
    // Other existing rules can match too, so resolve every category that was touched.
    const all = await listCategories(user.id);
    const byId = new Map(all.map((c) => [c.id, c]));
    for (const c of all) {
      if (retro[c.id]) {
        retroCategories[c.id] = {
          id: c.id,
          name: c.name,
          color: c.color,
          icon: c.icon,
          parentName: c.parentId ? (byId.get(c.parentId)?.name ?? null) : null,
        };
      }
    }
  }

  // A rule was just created for this category: nothing left to suggest.
  const ruleSuggestion =
    categoryId && !ruleData ? ((await suggestionForTransaction(db, user.id, transactionId)) ?? undefined) : undefined;

  const ruleProposal =
    categoryId && !ruleData && !ruleSuggestion ? await loadRuleProposal(user.id, transactionId, categoryId) : undefined;

  revalidatePath("/transactions");
  revalidatePath("/", "layout");
  return {
    status: "done",
    category: result.category,
    categorySource: result.categorySource,
    retro,
    retroCategories,
    ruleSuggestion,
    ruleId,
    ruleProposal,
  };
}

export type ValidateResult = { status: "done" } | { status: "error"; error: "invalidInput" | "needsCategory" };

/** The ✓ and swipe-right on a row: accepts a guess, or marks a row that already has a category as reviewed. */
export async function validateTransactionAction(input: unknown): Promise<ValidateResult> {
  const user = await requireUser();
  const parsed = z.object({ transactionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };
  const { transactionId } = parsed.data;

  const accepted = await acceptGuess(db, user.id, transactionId);
  if (!accepted) {
    const changed = await markReviewed(db, user.id, { ids: [transactionId] });
    // Nothing changed and the row is still waiting: it has no category (an already reviewed row is a no-op).
    if (changed.length === 0 && (await countWaitingForCategory(db, user.id, { ids: [transactionId] })) > 0) {
      return { status: "error", error: "needsCategory" };
    }
  }
  revalidatePath("/transactions");
  revalidatePath("/", "layout");
  return { status: "done" };
}

export type BulkCategorizeErrorCode = "invalidInput" | "categoryNotFound";

export type BulkCategorizeResult =
  | {
      status: "done";
      updated: number;
      /** Split transactions left as they are. */
      skipped: number;
      category: CategoryInfo | null;
      /** The first rule suggestion the edited rows qualify for, if any. */
      ruleSuggestion?: RuleSuggestionDetails;
    }
  | { status: "error"; error: BulkCategorizeErrorCode };

const MAX_BULK = 500;

const bulkInput = z.object({
  // Deduped so the count reported back matches the rows actually touched.
  transactionIds: z
    .array(z.uuid())
    .min(1)
    .max(MAX_BULK)
    .transform((ids) => [...new Set(ids)]),
  categoryId: z.uuid().nullable(),
});

/** Sets (or clears) the category of several transactions by hand, in one transaction. */
export async function bulkCategorize(input: unknown): Promise<BulkCategorizeResult> {
  const user = await requireUser();

  const parsed = bulkInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const result = await bulkSetTransactionCategory(db, user.id, parsed.data.transactionIds, parsed.data.categoryId);
  if (!result) return { status: "error", error: "categoryNotFound" };

  const ruleSuggestion = parsed.data.categoryId
    ? ((await suggestionForTransactions(db, user.id, parsed.data.transactionIds)) ?? undefined)
    : undefined;

  revalidatePath("/transactions");
  revalidatePath("/", "layout");
  return {
    status: "done",
    updated: result.updated,
    skipped: result.skipped,
    category: result.category,
    ruleSuggestion,
  };
}

/** Codes, not copy: the dialog translates them (`transactions.transfer.errors.*`). */
export type TransferErrorCode =
  | "invalidInput"
  | "notFound"
  | "alreadyLinked"
  | "sameSign"
  | "amountMismatch"
  | "sameAccount"
  | "split"
  | "notSavings"
  | "savingsSource"
  | "zero"
  | "ignored"
  | "notCreated"
  | "goalNotFound"
  | "exceedsSaved";

export type TransferInfoResult =
  | { status: "done"; transfer: TransferForTransaction | null; candidates: TransferCandidate[] }
  | { status: "error"; error: TransferErrorCode };

export type TransferChangeResult =
  | { status: "done"; transfer: TransferForTransaction | null }
  | { status: "error"; error: TransferErrorCode };

const transactionIdInput = z.object({ transactionId: z.uuid() });
const linkInput = z.object({ transactionId: z.uuid(), counterpartId: z.uuid() });
const transferIdInput = z.object({ transferId: z.uuid(), transactionId: z.uuid() });

/** The dialog's transfer state: the pair the row is in, or candidate counterparts when it is in none. */
export async function getTransferInfo(input: unknown): Promise<TransferInfoResult> {
  const user = await requireUser();
  const parsed = transactionIdInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const transfer = await getTransferForTransaction(db, user.id, parsed.data.transactionId);
  if (transfer) return { status: "done", transfer, candidates: [] };
  const candidates = await listTransferCandidates(db, user.id, parsed.data.transactionId);
  if (!candidates) return { status: "error", error: "notFound" };
  return { status: "done", transfer: null, candidates };
}

async function afterTransferChange(userId: string): Promise<void> {
  // Paired rows leave (or re-enter) recurring detection.
  await refreshRecurringAfterTransferChange(userId);
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/recurring");
  // The nav counter: linking and confirming mark both legs reviewed.
  revalidatePath("/", "layout");
}

/** Links two transactions as an internal transfer by hand (confirmed at once). */
export async function linkTransferAction(input: unknown): Promise<TransferChangeResult> {
  const user = await requireUser();
  const parsed = linkInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };
  const { transactionId, counterpartId } = parsed.data;

  const result = await linkTransfer(db, user.id, transactionId, counterpartId);
  if (!result.ok) return { status: "error", error: result.error };
  await afterTransferChange(user.id);
  return { status: "done", transfer: await getTransferForTransaction(db, user.id, transactionId) };
}

/** Confirms a detected pair. */
export async function confirmTransferAction(input: unknown): Promise<TransferChangeResult> {
  const user = await requireUser();
  const parsed = transferIdInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const confirmed = await confirmTransfer(db, user.id, parsed.data.transferId);
  if (!confirmed) return { status: "error", error: "notFound" };
  await afterTransferChange(user.id);
  return { status: "done", transfer: await getTransferForTransaction(db, user.id, parsed.data.transactionId) };
}

/** Dissolves a pair; detection will not suggest it again. */
export async function unlinkTransferAction(input: unknown): Promise<TransferChangeResult> {
  const user = await requireUser();
  const parsed = transferIdInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const removed = await unlinkTransfer(db, user.id, parsed.data.transferId);
  if (!removed) return { status: "error", error: "notFound" };
  await afterTransferChange(user.id);
  return { status: "done", transfer: null };
}

const moveInput = z.object({ transactionId: z.uuid(), accountId: z.uuid(), goalId: z.uuid().nullable().default(null), withRule: z.boolean().default(false) });

export type MoveToSavingsResult =
  | { status: "done"; transfer: TransferForTransaction | null; ruleId: string | null; pastMoved: number }
  | { status: "error"; error: TransferErrorCode };

/** "Move to savings": creates the counterpart on a Savings account and links the pair (Slice 52). */
export async function moveToSavingsAction(input: unknown): Promise<MoveToSavingsResult> {
  const user = await requireUser();
  const parsed = moveInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const result = await moveToSavings(db, user.id, parsed.data);
  if (!result.ok) return { status: "error", error: result.error };
  await afterTransferChange(user.id);
  return {
    status: "done",
    transfer: await getTransferForTransaction(db, user.id, parsed.data.transactionId),
    ruleId: result.ruleId,
    pastMoved: result.pastMoved,
  };
}

const removeMoveInput = z.object({ transferId: z.uuid(), ruleId: z.uuid().optional() });

export type RemoveSavingsMoveResult =
  | { status: "done"; sourceId: string; accountId: string; goalId: string | null }
  | { status: "error"; error: TransferErrorCode };

/** Undoes a move: the created row (and the rule and rows of the same action) go; the user's rows stay. */
export async function removeSavingsMoveAction(input: unknown): Promise<RemoveSavingsMoveResult> {
  const user = await requireUser();
  const parsed = removeMoveInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const result = await removeSavingsMove(db, user.id, parsed.data);
  if (!result.ok) return { status: "error", error: result.error };
  await afterTransferChange(user.id);
  revalidatePath("/accounts");
  return { status: "done", sourceId: result.sourceId, accountId: result.accountId, goalId: result.goalId };
}

const moveGoalInput = z.object({ transferId: z.uuid(), transactionId: z.uuid(), goalId: z.uuid().nullable() });

/** Changes the goal a move belongs to, or clears it (Slice 55). */
export async function setMoveGoalAction(input: unknown): Promise<TransferChangeResult> {
  const user = await requireUser();
  const parsed = moveGoalInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const result = await setMoveGoal(db, user.id, { transferId: parsed.data.transferId, goalId: parsed.data.goalId });
  if (!result.ok) return { status: "error", error: result.error };
  revalidatePath("/settings/goals");
  revalidatePath("/accounts");
  revalidatePath("/budget");
  revalidatePath("/");
  return { status: "done", transfer: await getTransferForTransaction(db, user.id, parsed.data.transactionId) };
}

/** Codes, not copy: the editor translates them (`transactions.split.errors.*`). */
export type SplitActionErrorCode = SplitWriteError | "invalidInput";

export type SaveSplitActionResult =
  | { status: "done"; parts: SplitPart[] }
  | { status: "error"; error: SplitActionErrorCode };

export type RemoveSplitActionResult =
  | {
      status: "done";
      /** The row's own category, which applies again now that the split is gone. */
      category: CategoryInfo | null;
      categorySource: "manual" | "rule" | "bank" | "guess" | null;
    }
  | { status: "error"; error: SplitActionErrorCode };

const saveSplitInput = z.object({
  transactionId: z.uuid(),
  parts: z
    .array(z.object({ categoryId: z.uuid(), amountCents: z.number().int() }))
    .min(MIN_SPLIT_PARTS)
    .max(MAX_SPLIT_PARTS),
});

// A split changes per-category figures on the dashboard and budgets, not just this list.
function revalidateAfterSplit(): void {
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/settings/budgets");
  // The nav counter: saving a split marks the row reviewed.
  revalidatePath("/", "layout");
}

/** Replaces the parts of a transaction; the sum and signs are checked again on the server. */
export async function saveSplitAction(input: unknown): Promise<SaveSplitActionResult> {
  const user = await requireUser();
  const parsed = saveSplitInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const result = await saveSplit(db, user.id, parsed.data.transactionId, parsed.data.parts);
  if (!result.ok) return { status: "error", error: result.error };
  revalidateAfterSplit();
  return { status: "done", parts: result.parts };
}

/** Removes the split; the row goes back to the category it had before. */
export async function removeSplitAction(input: unknown): Promise<RemoveSplitActionResult> {
  const user = await requireUser();
  const parsed = transactionIdInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const result = await removeSplit(db, user.id, parsed.data.transactionId);
  if (!result.ok) return { status: "error", error: result.error };
  revalidateAfterSplit();
  return { status: "done", category: result.category, categorySource: result.categorySource };
}

/** Codes, not copy: the sheet translates them (`transactions.errors.*`). */
export type IgnoreResult =
  | { status: "done" }
  | { status: "error"; error: "invalidInput" | "notFound" | "inTransfer" };

const ignoreInput = z.object({ id: z.uuid() });

async function changeIgnored(input: unknown, ignored: boolean): Promise<IgnoreResult> {
  const user = await requireUser();
  const parsed = ignoreInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };
  const { id } = parsed.data;

  const changed = await setIgnored(db, user.id, [id], ignored);
  if (changed.length === 0) {
    // Not changed: either not the user's row, or a transfer leg that has to be unlinked first.
    const transfer = ignored ? await getTransferForTransaction(db, user.id, id) : null;
    return { status: "error", error: transfer ? "inTransfer" : "notFound" };
  }
  // Totals, recurring detection and transfer pairing all read "countable" rows.
  await refreshDerivedData(user.id, "ignoreChange");
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/recurring");
  revalidatePath("/review");
  revalidatePath("/", "layout");
  return { status: "done" };
}

/** Sets a transaction aside: out of totals, hidden from the list, and it never comes back on a sync or import. */
export async function ignoreTransactionAction(input: unknown): Promise<IgnoreResult> {
  return changeIgnored(input, true);
}

/** Brings an ignored transaction back into totals. */
export async function unignoreTransactionAction(input: unknown): Promise<IgnoreResult> {
  return changeIgnored(input, false);
}

/** The ids of the categories to offer as pills for one row; never throws on bad input, just offers none. */
export async function categorySuggestionsAction(input: unknown): Promise<string[]> {
  const user = await requireUser();
  const parsed = z.object({ transactionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return [];
  return categorySuggestionsFor(db, user.id, parsed.data.transactionId);
}

export interface LoanPaymentInfo {
  loanId: string;
  loanName: string;
  paidCents: number;
  capitalCents: number;
  interestCents: number;
  insuranceCents: number;
}

/** The loan this bank row repays and how franC splits it, or null when the row is not a loan payment. */
export async function getLoanPaymentInfo(input: unknown): Promise<LoanPaymentInfo | null> {
  const user = await requireUser();
  const parsed = transactionIdInput.safeParse(input);
  if (!parsed.success) return null;
  const data = await getLoanForTransaction(db, user.id, parsed.data.transactionId);
  if (!data) return null;
  const view = loanView({ loan: data.loan, checkpoints: data.checkpoints, payments: data.payments, splits: data.splits, item: data.item }, "9999-12-31");
  const entry = view.ledger.entries.find((e) => e.kind === "payment" && e.transactionId === parsed.data.transactionId);
  if (entry?.kind !== "payment") return null;
  return { loanId: data.loan.id, loanName: data.loan.name, paidCents: entry.paidCents, capitalCents: entry.capitalCents, interestCents: entry.interestCents, insuranceCents: entry.insuranceCents };
}
