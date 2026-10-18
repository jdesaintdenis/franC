import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import type { db as dbClient } from "../client";
import { buildGuesser, type GuessExample } from "../../lib/categorize/guess";
import { suggestCategories } from "../../lib/categorize/suggest-categories";
import { compileMatcher } from "../../lib/categorize/rules";
import { merchantKey } from "../../lib/recurring/merchant-key";
import {
  suggestionForRow,
  suggestRules,
  type RuleSuggestion,
  type SuggestionRow,
} from "../../lib/categorize/suggest-rule";
import { categories, merchants, ruleSuggestionDismissals, transactions } from "../schema";
import { applyBankMappings } from "./bank-categories";
import { applyRulesInTransaction, loadCompiledRules } from "./category-rules";
import { notSplit } from "./split-sql";
import { countable } from "./transfer-sql";
import { toCategoryDisplay, type CategoryDisplay } from "./transactions";

const CHUNK_SIZE = 1000;
/** How many of the newest categorized rows guessing learns from. */
export const EXAMPLE_LIMIT = 5000;
/** Suggestions checked after a bulk edit. */
const BULK_SUGGESTION_CHECKS = 25;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

type Selectable = Pick<typeof dbClient, "select">;
type Updatable = Pick<typeof dbClient, "select" | "update">;

/** The user's newest hand- or rule-categorized, unsplit, non-transfer rows. */
export async function loadGuessExamples(database: Selectable, userId: string): Promise<GuessExample[]> {
  const rows = await database
    .select({
      categoryId: transactions.categoryId,
      merchantId: transactions.merchantId,
      labelNormalized: transactions.labelNormalized,
      amountCents: transactions.amountCents,
      date: transactions.date,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        inArray(transactions.categorySource, ["manual", "rule"]),
        sql`${transactions.categoryId} is not null`,
        notSplit(userId),
        countable(userId),
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(EXAMPLE_LIMIT);
  const examples: GuessExample[] = [];
  for (const r of rows) {
    if (r.categoryId !== null) examples.push({ ...r, categoryId: r.categoryId, labelNormalized: r.labelNormalized ?? "" });
  }
  return examples;
}

export interface GuessOptions {
  /** Only these rows are guessed (the rows of an import). Without it, every candidate. */
  ids?: string[];
  /** Puts guessed rows back in the review queue (the "Guess categories" button). */
  requeue?: boolean;
}

/**
 * Guesses the category of uncategorized, unsplit rows outside transfer pairs and writes it with
 * source 'guess'. Every update is guarded by `category_id IS NULL` and `notSplit`, so nothing
 * categorized meanwhile is overwritten. Returns the ids that were guessed.
 */
export async function guessInTransaction(
  tx: Updatable,
  userId: string,
  opts: GuessOptions = {},
): Promise<string[]> {
  if (opts.ids && opts.ids.length === 0) return [];
  const examples = await loadGuessExamples(tx, userId);
  if (examples.length === 0) return [];
  const guess = buildGuesser(examples);

  const candidates: { id: string; merchantId: string | null; labelNormalized: string | null; amountCents: number; date: string }[] = [];
  const parts = opts.ids ? chunk(opts.ids, CHUNK_SIZE) : [undefined];
  for (const part of parts) {
    candidates.push(
      ...(await tx
        .select({
          id: transactions.id,
          merchantId: transactions.merchantId,
          labelNormalized: transactions.labelNormalized,
          amountCents: transactions.amountCents,
          date: transactions.date,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            isNull(transactions.categoryId),
            notSplit(userId),
            countable(userId),
            part ? inArray(transactions.id, part) : undefined,
          ),
        )),
    );
  }

  const byCategory = new Map<string, string[]>();
  for (const row of candidates) {
    const result = guess({ ...row, labelNormalized: row.labelNormalized ?? "" });
    if (!result) continue;
    const ids = byCategory.get(result.categoryId) ?? [];
    ids.push(row.id);
    byCategory.set(result.categoryId, ids);
  }

  const guessed: string[] = [];
  for (const [categoryId, ids] of byCategory) {
    for (const part of chunk(ids, CHUNK_SIZE)) {
      const done = await tx
        .update(transactions)
        .set({
          categoryId,
          categorySource: "guess",
          ...(opts.requeue ? { reviewedAt: null } : {}),
        })
        .where(
          and(
            eq(transactions.userId, userId),
            inArray(transactions.id, part),
            isNull(transactions.categoryId),
            notSplit(userId),
          ),
        )
        .returning({ id: transactions.id });
      guessed.push(...done.map((d) => d.id));
    }
  }
  return guessed;
}

export interface GuessCategoriesResult {
  rules: number;
  bank: number;
  guessed: number;
}

/** "Guess categories": rules, then bank mappings, then guesses, in one DB transaction. */
export async function guessCategories(database: typeof dbClient, userId: string): Promise<GuessCategoriesResult> {
  return database.transaction(async (tx) => {
    const rules = await applyRulesInTransaction(tx, userId);
    const bank = await applyBankMappings(tx, userId);
    const guessed = await guessInTransaction(tx, userId, { requeue: true });
    return { rules: rules.updated, bank, guessed: guessed.length };
  });
}

/** Category ids to offer first for one of the user's rows (see `suggestCategories`); empty when the row is not theirs. */
export async function categorySuggestionsFor(database: Selectable, userId: string, transactionId: string): Promise<string[]> {
  const [row] = await database
    .select({ merchantId: transactions.merchantId, labelNormalized: transactions.labelNormalized, date: transactions.date })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
    .limit(1);
  if (!row) return [];
  return suggestCategories(await loadGuessExamples(database, userId), { ...row, labelNormalized: row.labelNormalized ?? "" });
}

/** What a guess accepted or not: the row's category, for the UI to show. */
export async function acceptGuess(
  database: typeof dbClient,
  userId: string,
  transactionId: string,
): Promise<{ category: CategoryDisplay } | null> {
  const [updated] = await database
    .update(transactions)
    .set({ categorySource: "manual", reviewedAt: sql`now()` })
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.userId, userId),
        eq(transactions.categorySource, "guess"),
        sql`${transactions.categoryId} is not null`,
      ),
    )
    .returning({ categoryId: transactions.categoryId });
  if (!updated?.categoryId) return null;
  const [category] = await database
    .select()
    .from(categories)
    .where(and(eq(categories.id, updated.categoryId), eq(categories.userId, userId)))
    .limit(1);
  return category ? { category: await toCategoryDisplay(database, userId, category) } : null;
}

// ---------------------------------------------------------------------------------------------
// Rule suggestions

export interface RuleSuggestionDetails extends RuleSuggestion {
  category: CategoryDisplay;
  /** Uncategorized, bank-categorized or guessed unsplit rows the rule would categorize now. */
  wouldCategorize: number;
}

interface ManualRow extends SuggestionRow {
  id: string;
}

async function loadManualRows(database: Selectable, userId: string, extra?: SQL): Promise<ManualRow[]> {
  const rows = await database
    .select({
      id: transactions.id,
      categoryId: transactions.categoryId,
      merchantId: transactions.merchantId,
      merchantName: merchants.name,
      labelNormalized: transactions.labelNormalized,
      labelDisplay: transactions.labelDisplay,
    })
    .from(transactions)
    .leftJoin(merchants, and(eq(merchants.id, transactions.merchantId), eq(merchants.userId, userId)))
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.categorySource, "manual"),
        sql`${transactions.categoryId} is not null`,
        notSplit(userId),
        extra,
      ),
    );
  const manual: ManualRow[] = [];
  for (const r of rows) if (r.categoryId !== null) manual.push({ ...r, categoryId: r.categoryId, labelNormalized: r.labelNormalized ?? "" });
  return manual;
}

function loadDismissals(database: Selectable, userId: string) {
  return database
    .select({
      matchType: ruleSuggestionDismissals.matchType,
      pattern: ruleSuggestionDismissals.pattern,
      categoryId: ruleSuggestionDismissals.categoryId,
    })
    .from(ruleSuggestionDismissals)
    .where(eq(ruleSuggestionDismissals.userId, userId));
}

/** Adds the category display and how many rows each suggestion would categorize now. */
async function withDetails(
  database: Selectable,
  userId: string,
  suggestions: RuleSuggestion[],
): Promise<RuleSuggestionDetails[]> {
  if (suggestions.length === 0) return [];
  const fillable = await database
    .select({
      labelNormalized: transactions.labelNormalized,
      labelDisplay: transactions.labelDisplay,
      merchantName: merchants.name,
    })
    .from(transactions)
    .leftJoin(merchants, and(eq(merchants.id, transactions.merchantId), eq(merchants.userId, userId)))
    .where(
      and(
        eq(transactions.userId, userId),
        or(isNull(transactions.categoryId), inArray(transactions.categorySource, ["bank", "guess"])),
        notSplit(userId),
      ),
    );
  const cats = await database
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), inArray(categories.id, [...new Set(suggestions.map((s) => s.categoryId))])));
  const byId = new Map(cats.map((c) => [c.id, c]));

  const details: RuleSuggestionDetails[] = [];
  for (const s of suggestions) {
    const category = byId.get(s.categoryId);
    if (!category) continue;
    const matches = compileMatcher(s);
    const wouldCategorize = fillable.filter((r) =>
      matches({ normalized: r.labelNormalized, display: r.labelDisplay, merchant: r.merchantName }),
    ).length;
    details.push({ ...s, category: await toCategoryDisplay(database, userId, category), wouldCategorize });
  }
  return details;
}

/** Every current suggestion (Settings > Rules), biggest group first, at most 10. */
export async function listRuleSuggestions(database: typeof dbClient, userId: string): Promise<RuleSuggestionDetails[]> {
  const [rows, rules, dismissals] = await Promise.all([
    loadManualRows(database, userId),
    loadCompiledRules(database, userId),
    loadDismissals(database, userId),
  ]);
  return withDetails(database, userId, suggestRules(rows, rules, dismissals));
}

/** The suggestion the group of this (manually categorized) transaction qualifies for now, if any. */
export async function suggestionForTransaction(
  database: typeof dbClient,
  userId: string,
  transactionId: string,
): Promise<RuleSuggestionDetails | null> {
  const [own] = await loadManualRows(database, userId, eq(transactions.id, transactionId));
  if (!own) return null;
  const groupFilter =
    own.merchantId !== null
      ? eq(transactions.merchantId, own.merchantId)
      : and(
          isNull(transactions.merchantId),
          sql`position(${merchantKey(own.labelNormalized)} in ${transactions.labelNormalized}) > 0`,
        );
  const [group, rules, dismissals] = await Promise.all([
    loadManualRows(database, userId, groupFilter),
    loadCompiledRules(database, userId),
    loadDismissals(database, userId),
  ]);
  const suggestion = suggestionForRow(own, group, rules, dismissals);
  if (!suggestion) return null;
  return (await withDetails(database, userId, [suggestion]))[0] ?? null;
}

/** After a bulk edit: the first qualifying suggestion among the edited rows. */
export async function suggestionForTransactions(
  database: typeof dbClient,
  userId: string,
  transactionIds: readonly string[],
): Promise<RuleSuggestionDetails | null> {
  for (const id of transactionIds.slice(0, BULK_SUGGESTION_CHECKS)) {
    const s = await suggestionForTransaction(database, userId, id);
    if (s) return s;
  }
  return null;
}

/** "Not now". False when the category isn't the user's. Repeating it is harmless. */
export async function dismissRuleSuggestion(
  database: typeof dbClient,
  userId: string,
  input: { matchType: "equals" | "contains"; pattern: string; categoryId: string },
): Promise<boolean> {
  const [owned] = await database
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, input.categoryId), eq(categories.userId, userId)))
    .limit(1);
  if (!owned) return false;
  await database.insert(ruleSuggestionDismissals).values({ userId, ...input }).onConflictDoNothing();
  return true;
}
