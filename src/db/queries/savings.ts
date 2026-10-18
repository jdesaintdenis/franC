import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { compileMatcher } from "../../lib/categorize/rules";
import { matchSavingsRule, savingsRulePattern } from "../../lib/savings/rules";
import { savedByMonth, type SavedPair } from "../../lib/savings/saved";
import type { db as dbClient } from "../client";
import { accounts, merchants, savingsGoalContributions, savingsGoals, savingsRules, transactions, transfers, type SavingsRule } from "../schema";
import { getFrancImportId } from "./accounts";
import { goalHolds } from "./goals";
import { isSplit, notSplit } from "./split-sql";
import { countable, notInTransfer } from "./transfer-sql";
import { markLegsReviewed } from "./transfers";
import type { AccountScope } from "./dashboard";

type Tx = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];

export type MoveError =
  | "notFound"
  | "alreadyLinked"
  | "split"
  | "ignored"
  | "zero"
  | "notSavings"
  | "savingsSource"
  | "goalNotFound"
  | "exceedsSaved";

export type MoveResult =
  | { ok: true; transferId: string; createdId: string; ruleId: string | null; pastMoved: number }
  | { ok: false; error: MoveError };

/** What a created row copies from the row it mirrors. */
interface MoveSource {
  id: string;
  date: string;
  bookedOn: string | null;
  amountCents: number;
  labelRaw: string | null;
  labelNormalized: string | null;
  labelDisplay: string | null;
  merchantId: string | null;
}

/**
 * Creates the counterpart row on a Savings account and links the pair as a confirmed transfer. The caller has
 * locked and validated the source row. The created row is marked as created by franC (so imports never dedupe
 * against it), has no category and is reviewed at once, like both legs of any confirmed transfer.
 */
async function insertMove(
  tx: Tx,
  userId: string,
  source: MoveSource,
  accountId: string,
  goalId: string | null,
): Promise<{ transferId: string; createdId: string }> {
  const importId = await getFrancImportId(tx, userId, accountId);
  const [created] = await tx
    .insert(transactions)
    .values({
      userId,
      accountId,
      importId,
      date: source.date,
      bookedOn: source.bookedOn,
      amountCents: -source.amountCents,
      labelRaw: source.labelRaw,
      labelNormalized: source.labelNormalized,
      labelDisplay: source.labelDisplay,
      merchantId: source.merchantId,
      dedupeHash: `franc:${source.id}`,
      occurrenceIndex: 0,
      source: "franc",
      createdFromId: source.id,
    })
    .returning({ id: transactions.id });
  const [outId, inId] = source.amountCents < 0 ? [source.id, created.id] : [created.id, source.id];
  const [transfer] = await tx
    .insert(transfers)
    .values({ userId, outTransactionId: outId, inTransactionId: inId, status: "confirmed" })
    .returning({ id: transfers.id });
  await markLegsReviewed(tx, userId, [source.id, created.id]);
  // The created row is that goal's money: the goal holds the sum of its entries.
  if (goalId) {
    await tx
      .insert(savingsGoalContributions)
      .values({ userId, goalId, transactionId: created.id, date: source.date, amountCents: -source.amountCents });
  }
  return { transferId: transfer.id, createdId: created.id };
}

/**
 * Checks the goal a move is tagged with: the user's, on this Savings account, and (for money out) holding enough.
 * Locks the goal row so two moves can't both draw the same money.
 */
async function checkGoalForMove(
  tx: Tx,
  userId: string,
  goalId: string,
  accountId: string,
  savingsLegCents: number,
): Promise<MoveError | null> {
  const [goal] = await tx
    .select({ id: savingsGoals.id })
    .from(savingsGoals)
    .where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.userId, userId), eq(savingsGoals.accountId, accountId)))
    .for("update");
  if (!goal) return "goalNotFound";
  if (savingsLegCents < 0 && (await goalHolds(tx, userId, goalId)) + savingsLegCents < 0) return "exceedsSaved";
  return null;
}

const moveSourceColumns = {
  id: transactions.id,
  date: transactions.date,
  bookedOn: transactions.bookedOn,
  amountCents: transactions.amountCents,
  labelRaw: transactions.labelRaw,
  labelNormalized: transactions.labelNormalized,
  labelDisplay: transactions.labelDisplay,
  merchantId: transactions.merchantId,
};

/**
 * Rows on current accounts a savings rule may move: not in a transfer, not ignored, not split, not zero.
 * Joined to merchants because rules match the merchant name too.
 */
function candidateRows(tx: Tx, userId: string, createdFrom?: Date) {
  return tx
    .select({ ...moveSourceColumns, createdAt: transactions.createdAt, merchantName: merchants.name })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.userId, userId), eq(accounts.savings, false)))
    .leftJoin(merchants, and(eq(merchants.id, transactions.merchantId), eq(merchants.userId, userId)))
    .where(
      and(
        eq(transactions.userId, userId),
        countable(userId),
        notSplit(userId),
        sql`${transactions.amountCents} <> 0`,
        createdFrom ? gte(transactions.createdAt, createdFrom) : undefined,
      ),
    );
}

/** Moves each id to its Savings account: locks the rows, re-checks they're still free, then inserts the pairs. */
async function moveRows(
  tx: Tx,
  userId: string,
  moves: Array<{ id: string; accountId: string; goalId: string | null }>,
): Promise<number> {
  if (moves.length === 0) return 0;
  const ids = moves.map((m) => m.id);
  await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids)))
    .orderBy(asc(transactions.id))
    .for("update");
  // A separate statement after the locks, so it sees a pair or a split committed while we waited.
  const free = await tx
    .select(moveSourceColumns)
    .from(transactions)
    .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids), countable(userId), notSplit(userId)));
  const moveOf = new Map(moves.map((m) => [m.id, m]));
  let moved = 0;
  for (const row of free) {
    const move = moveOf.get(row.id)!;
    await insertMove(tx, userId, row, move.accountId, move.goalId);
    moved += 1;
  }
  return moved;
}

/**
 * "Move to savings" on one row: creates the counterpart on `accountId` (a Savings account) and links the pair,
 * in one DB transaction. With `withRule` it also stores a label rule for that account and moves every existing
 * matching row at once; all rows of the action share the rule's `created_at` (the transaction's `now()`), which
 * is how `removeSavingsMove` finds them again.
 */
export async function moveToSavings(
  database: typeof dbClient,
  userId: string,
  input: { transactionId: string; accountId: string; goalId?: string | null; withRule: boolean },
): Promise<MoveResult> {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select({ ...moveSourceColumns, ignoredAt: transactions.ignoredAt, sourceSavings: accounts.savings })
      .from(transactions)
      .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.userId, userId)))
      .where(and(eq(transactions.userId, userId), eq(transactions.id, input.transactionId)))
      .for("update", { of: transactions });
    if (!row) return { ok: false as const, error: "notFound" as const };
    if (row.sourceSavings) return { ok: false as const, error: "savingsSource" as const };
    if (row.amountCents === 0) return { ok: false as const, error: "zero" as const };
    if (row.ignoredAt !== null) return { ok: false as const, error: "ignored" as const };

    const [splitRow] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.id, row.id), isSplit(userId)));
    if (splitRow) return { ok: false as const, error: "split" as const };
    const [paired] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.id, row.id), sql`NOT ${notInTransfer(userId)}`));
    if (paired) return { ok: false as const, error: "alreadyLinked" as const };

    const [target] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, userId), eq(accounts.savings, true)));
    if (!target) return { ok: false as const, error: "notSavings" as const };

    const goalId = input.goalId ?? null;
    if (goalId) {
      const error = await checkGoalForMove(tx, userId, goalId, target.id, -row.amountCents);
      if (error) return { ok: false as const, error };
    }
    const { transferId, createdId } = await insertMove(tx, userId, row, target.id, goalId);

    let ruleId: string | null = null;
    let pastMoved = 0;
    if (input.withRule) {
      const [merchant] = row.merchantId
        ? await tx
            .select({ name: merchants.name })
            .from(merchants)
            .where(and(eq(merchants.id, row.merchantId), eq(merchants.userId, userId)))
        : [];
      const pattern = savingsRulePattern(merchant?.name ?? null, row.labelNormalized ?? "");
      if (pattern !== null) {
        const [rule] = await tx
          .insert(savingsRules)
          // Only money in goes to a goal.
          .values({ userId, accountId: target.id, goalId: row.amountCents < 0 ? goalId : null, pattern })
          .onConflictDoNothing()
          .returning({ id: savingsRules.id });
        if (rule) {
          ruleId = rule.id;
          const matches = compileMatcher({ matchType: "contains", pattern });
          const candidates = (await candidateRows(tx, userId)).filter((c) =>
            matches({ normalized: c.labelNormalized, display: c.labelDisplay, merchant: c.merchantName }),
          );
          const ruleGoalId = row.amountCents < 0 ? goalId : null;
          pastMoved = await moveRows(
            tx,
            userId,
            candidates.map((c) => ({ id: c.id, accountId: target.id, goalId: c.amountCents < 0 ? ruleGoalId : null })),
          );
        }
      }
    }
    return { ok: true as const, transferId, createdId, ruleId, pastMoved };
  });
}

export type RemoveMoveResult =
  | { ok: true; sourceId: string; accountId: string; goalId: string | null }
  | { ok: false; error: "notFound" | "notCreated" };

/**
 * Undoes a move: deletes the row franC created (the pair goes with it) and, when `ruleId` is given, the rule and
 * every row it moved in the same action (they share the rule's `created_at`). The user's own rows are never touched.
 */
export async function removeSavingsMove(
  database: typeof dbClient,
  userId: string,
  input: { transferId: string; ruleId?: string },
): Promise<RemoveMoveResult> {
  return database.transaction(async (tx) => {
    const [pair] = await tx
      .select()
      .from(transfers)
      .where(and(eq(transfers.id, input.transferId), eq(transfers.userId, userId)));
    if (!pair) return { ok: false as const, error: "notFound" as const };
    const legs = await tx
      .select({ id: transactions.id, accountId: transactions.accountId, createdFromId: transactions.createdFromId })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, [pair.outTransactionId, pair.inTransactionId])));
    const created = legs.find((l) => l.createdFromId !== null);
    if (!created) return { ok: false as const, error: "notCreated" as const };

    // Read before the delete takes the entry with it, so Undo can move the money to the same goal again.
    const [entry] = await tx
      .select({ goalId: savingsGoalContributions.goalId })
      .from(savingsGoalContributions)
      .where(and(eq(savingsGoalContributions.transactionId, created.id), eq(savingsGoalContributions.userId, userId)));
    await tx.delete(transactions).where(and(eq(transactions.userId, userId), eq(transactions.id, created.id)));
    if (input.ruleId) {
      const [rule] = await tx
        .select()
        .from(savingsRules)
        .where(and(eq(savingsRules.id, input.ruleId), eq(savingsRules.userId, userId)));
      if (rule) {
        await tx
          .delete(transactions)
          .where(
            and(
              eq(transactions.userId, userId),
              eq(transactions.accountId, rule.accountId),
              eq(transactions.source, "franc"),
              // Compared in SQL: a JS Date would drop the microseconds Postgres stores.
              sql`${transactions.createdAt} = (SELECT sr."created_at" FROM "savings_rules" sr WHERE sr."id" = ${rule.id} AND sr."user_id" = ${userId})`,
            ),
          );
        await tx.delete(savingsRules).where(and(eq(savingsRules.id, rule.id), eq(savingsRules.userId, userId)));
      }
    }
    return { ok: true as const, sourceId: created.createdFromId!, accountId: created.accountId, goalId: entry?.goalId ?? null };
  });
}

/**
 * Moves rows inserted after a savings rule was created (an import or sync brought them) to the rule's Savings
 * account. Older rows were handled when the rule was created. Returns the number moved.
 */
export async function applySavingsRules(database: typeof dbClient, userId: string): Promise<number> {
  return database.transaction(async (tx) => {
    const rules = await tx
      .select({ rule: savingsRules })
      .from(savingsRules)
      .innerJoin(accounts, and(eq(accounts.id, savingsRules.accountId), eq(accounts.userId, userId), eq(accounts.savings, true)))
      .where(eq(savingsRules.userId, userId));
    if (rules.length === 0) return 0;
    const inputs = rules.map((r) => ({ ...r.rule, createdAt: r.rule.createdAt }));
    const oldest = inputs.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), inputs[0].createdAt);

    // A rule's goal only counts while the goal still sits on the rule's account.
    const goalAccount = new Map(
      (await tx.select({ id: savingsGoals.id, accountId: savingsGoals.accountId }).from(savingsGoals).where(eq(savingsGoals.userId, userId))).map(
        (g) => [g.id, g.accountId],
      ),
    );
    const moves: Array<{ id: string; accountId: string; goalId: string | null }> = [];
    for (const c of await candidateRows(tx, userId, oldest)) {
      const match = matchSavingsRule(inputs, {
        createdAt: c.createdAt,
        labels: { normalized: c.labelNormalized, display: c.labelDisplay, merchant: c.merchantName },
      });
      if (!match) continue;
      const goalId = c.amountCents < 0 && match.goalId && goalAccount.get(match.goalId) === match.accountId ? match.goalId : null;
      moves.push({ id: c.id, accountId: match.accountId, goalId });
    }
    return moveRows(tx, userId, moves);
  });
}

/** How many rows franC created for this user: the transactions list reloads when it changes (a move adds or removes rows). */
export async function countMovedRows(database: typeof dbClient, userId: string): Promise<number> {
  const [row] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.source, "franc")));
  return row?.n ?? 0;
}

export async function listSavingsRules(database: typeof dbClient, userId: string, accountId: string): Promise<SavingsRule[]> {
  return database
    .select()
    .from(savingsRules)
    .where(and(eq(savingsRules.userId, userId), eq(savingsRules.accountId, accountId)))
    .orderBy(asc(savingsRules.createdAt), asc(savingsRules.id));
}

/** Every rule of the user, for the accounts screen. */
export async function listAllSavingsRules(database: typeof dbClient, userId: string): Promise<SavingsRule[]> {
  return database
    .select()
    .from(savingsRules)
    .where(eq(savingsRules.userId, userId))
    .orderBy(asc(savingsRules.createdAt), asc(savingsRules.id));
}

/** Removes a rule (moves already made stay). Null when it isn't the user's. */
export async function deleteSavingsRule(database: typeof dbClient, userId: string, ruleId: string): Promise<SavingsRule | null> {
  const [row] = await database
    .delete(savingsRules)
    .where(and(eq(savingsRules.id, ruleId), eq(savingsRules.userId, userId)))
    .returning();
  return row ?? null;
}

/** Puts a removed rule back (Undo). False when the account isn't the user's Savings account. */
export async function restoreSavingsRule(
  database: typeof dbClient,
  userId: string,
  input: { accountId: string; pattern: string; goalId?: string | null },
): Promise<boolean> {
  const [account] = await database
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, userId), eq(accounts.savings, true)));
  if (!account) return false;
  const [goal] = input.goalId
    ? await database
        .select({ id: savingsGoals.id })
        .from(savingsGoals)
        .where(and(eq(savingsGoals.id, input.goalId), eq(savingsGoals.userId, userId), eq(savingsGoals.accountId, account.id)))
    : [];
  await database
    .insert(savingsRules)
    .values({ userId, accountId: account.id, goalId: goal?.id ?? null, pattern: input.pattern })
    .onConflictDoNothing();
  return true;
}

export type SetMoveGoalError = "notFound" | "notSavings" | "goalNotFound" | "exceedsSaved";

/**
 * Changes which goal a move belongs to (or none): replaces the entry that follows the Savings-account leg of
 * the pair. Money out needs a goal that holds enough.
 */
export async function setMoveGoal(
  database: typeof dbClient,
  userId: string,
  input: { transferId: string; goalId: string | null },
): Promise<{ ok: true } | { ok: false; error: SetMoveGoalError }> {
  return database.transaction(async (tx) => {
    const [pair] = await tx
      .select()
      .from(transfers)
      .where(and(eq(transfers.id, input.transferId), eq(transfers.userId, userId)));
    if (!pair) return { ok: false as const, error: "notFound" as const };
    const legs = await tx
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        date: transactions.date,
        amountCents: transactions.amountCents,
        savings: accounts.savings,
      })
      .from(transactions)
      .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.userId, userId)))
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, [pair.outTransactionId, pair.inTransactionId])));
    const savingsLegs = legs.filter((l) => l.savings);
    if (savingsLegs.length !== 1) return { ok: false as const, error: "notSavings" as const };
    const leg = savingsLegs[0];

    await tx
      .delete(savingsGoalContributions)
      .where(and(eq(savingsGoalContributions.transactionId, leg.id), eq(savingsGoalContributions.userId, userId)));
    if (input.goalId) {
      const error = await checkGoalForMove(tx, userId, input.goalId, leg.accountId, leg.amountCents);
      if (error === "goalNotFound" || error === "exceedsSaved") return { ok: false as const, error };
      await tx
        .insert(savingsGoalContributions)
        .values({ userId, goalId: input.goalId, transactionId: leg.id, date: leg.date, amountCents: leg.amountCents });
    }
    return { ok: true as const };
  });
}

/**
 * Saved per month: money moved into Savings accounts minus money taken out, from transfer pairs (synced, imported
 * or created by franC). With an account scope, a pair counts when either leg is on that account. Ignored legs are left out.
 */
export async function getSavedByMonth(
  database: typeof dbClient,
  userId: string,
  range: { from: string; to: string },
  scope?: AccountScope,
): Promise<Map<string, number>> {
  const out = alias(transactions, "out_leg");
  const inn = alias(transactions, "in_leg");
  const outAccount = alias(accounts, "out_account");
  const inAccount = alias(accounts, "in_account");
  const rows = await database
    .select({
      amountCents: inn.amountCents,
      outDate: out.date,
      inDate: inn.date,
      outSavings: outAccount.savings,
      inSavings: inAccount.savings,
    })
    .from(transfers)
    .innerJoin(out, and(eq(out.id, transfers.outTransactionId), eq(out.userId, userId)))
    .innerJoin(inn, and(eq(inn.id, transfers.inTransactionId), eq(inn.userId, userId)))
    .innerJoin(outAccount, and(eq(outAccount.id, out.accountId), eq(outAccount.userId, userId)))
    .innerJoin(inAccount, and(eq(inAccount.id, inn.accountId), eq(inAccount.userId, userId)))
    .where(
      and(
        eq(transfers.userId, userId),
        sql`${out.ignoredAt} IS NULL AND ${inn.ignoredAt} IS NULL`,
        sql`${outAccount.savings} <> ${inAccount.savings}`,
        scope?.accountId ? sql`(${out.accountId} = ${scope.accountId} OR ${inn.accountId} = ${scope.accountId})` : undefined,
      ),
    );
  const pairs: SavedPair[] = rows.map((r) => ({
    amountCents: r.amountCents,
    outDate: r.outDate,
    inDate: r.inDate,
    outSavings: r.outSavings,
    inSavings: r.inSavings,
  }));
  return savedByMonth(pairs, range);
}
