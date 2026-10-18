import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { GoalInput } from "../../lib/goals/input";
import { canAssign, goalMoneyByAccount, type AccountGoalMoney } from "../../lib/goals/money";
import type { GoalSnapshot } from "../../lib/goals/snapshot";
import type { db as dbClient } from "../client";
import { accounts, savingsGoalContributions, savingsGoals, savingsRules, transactions } from "../schema";
import { getAccountBalances } from "./balance";

type Executor = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];

const UNIQUE_VIOLATION = "23505";

export interface GoalRow {
  id: string;
  name: string;
  targetCents: number;
  targetDate: string | null;
  icon: string | null;
  /** Null for a goal tracked by hand. */
  accountId: string | null;
  accountName: string | null;
  /** What the goal holds: the sum of its entries. */
  savedCents: number;
  startCents: number;
  startDate: string;
}

/** The user's goals with what each holds, oldest first. Scoped by user_id. */
export async function listGoals(database: typeof dbClient, userId: string): Promise<GoalRow[]> {
  const [rows, owned] = await Promise.all([
    database
      .select({
        id: savingsGoals.id,
        name: savingsGoals.name,
        targetCents: savingsGoals.targetCents,
        targetDate: savingsGoals.targetDate,
        icon: savingsGoals.icon,
        accountId: savingsGoals.accountId,
        startCents: savingsGoals.startCents,
        startDate: savingsGoals.startDate,
        contributed: sql<string>`(
          select coalesce(sum(c.amount_cents), 0)::text from savings_goal_contributions c
          where c.goal_id = "savings_goals"."id" and c.user_id = "savings_goals"."user_id"
        )`,
      })
      .from(savingsGoals)
      .where(eq(savingsGoals.userId, userId))
      .orderBy(asc(savingsGoals.createdAt), asc(savingsGoals.id)),
    database.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.userId, userId)),
  ]);
  const nameById = new Map(owned.map((a) => [a.id, a.name]));

  return rows.map(({ contributed, ...r }) => {
    // An account id that isn't the user's (never written, but never trusted) reads as manual.
    const accountName = r.accountId === null ? undefined : nameById.get(r.accountId);
    if (accountName === undefined) return { ...r, accountId: null, accountName: null, savedCents: Number(contributed) };
    return { ...r, accountName, savedCents: Number(contributed) };
  });
}

/** The goals plus, per account that has goals, what they hold and what is Not assigned (Slice 55). */
export async function listGoalMoney(
  database: typeof dbClient,
  userId: string,
): Promise<{ goals: GoalRow[]; money: Map<string, AccountGoalMoney> }> {
  const [goals, balances] = await Promise.all([listGoals(database, userId), getAccountBalances(database, userId)]);
  return { goals, money: goalMoneyByAccount(goals, balances) };
}

export interface ContributionRow {
  id: string;
  goalId: string;
  date: string;
  amountCents: number;
  /** Label of the moved row this entry follows (Move to savings); null for manual entries and assignments. */
  label: string | null;
}

/** The newest `perGoal` contributions of each of the user's goals, newest first. */
export async function listRecentContributions(
  database: typeof dbClient,
  userId: string,
  perGoal = 5,
): Promise<Map<string, ContributionRow[]>> {
  const ranked = database
    .select({
      id: savingsGoalContributions.id,
      goalId: savingsGoalContributions.goalId,
      date: savingsGoalContributions.date,
      amountCents: savingsGoalContributions.amountCents,
      transactionId: savingsGoalContributions.transactionId,
      createdAt: savingsGoalContributions.createdAt,
      rank: sql<number>`row_number() over (
        partition by ${savingsGoalContributions.goalId}
        order by ${savingsGoalContributions.date} desc, ${savingsGoalContributions.createdAt} desc
      )`.as("rank"),
    })
    .from(savingsGoalContributions)
    .where(eq(savingsGoalContributions.userId, userId))
    .as("ranked");
  const rows = await database
    .select({
      id: ranked.id,
      goalId: ranked.goalId,
      date: ranked.date,
      amountCents: ranked.amountCents,
      label: sql<string | null>`coalesce(${transactions.labelDisplay}, ${transactions.labelRaw})`,
    })
    .from(ranked)
    .leftJoin(transactions, and(eq(transactions.id, ranked.transactionId), eq(transactions.userId, userId)))
    .where(sql`${ranked.rank} <= ${perGoal}`)
    .orderBy(desc(ranked.date), desc(ranked.createdAt));

  const byGoal = new Map<string, ContributionRow[]>();
  for (const row of rows) byGoal.set(row.goalId, [...(byGoal.get(row.goalId) ?? []), row]);
  return byGoal;
}

/** Goal names per account id (oldest goal first), for the account delete warning. */
export async function goalsByAccount(database: typeof dbClient, userId: string): Promise<Map<string, string[]>> {
  const rows = await database
    .select({ accountId: savingsGoals.accountId, name: savingsGoals.name })
    .from(savingsGoals)
    .where(and(eq(savingsGoals.userId, userId), isNotNull(savingsGoals.accountId)))
    .orderBy(asc(savingsGoals.createdAt), asc(savingsGoals.id));
  const out = new Map<string, string[]>();
  for (const r of rows) if (r.accountId) out.set(r.accountId, [...(out.get(r.accountId) ?? []), r.name]);
  return out;
}

export type GoalWriteError = "notFound" | "nameTaken" | "accountNotFound" | "notEmpty";
export type GoalWriteResult = { ok: true; id: string } | { ok: false; error: GoalWriteError };

/** Whether a unique violation hit (the goal name index is the only one left), looking through drizzle's cause chain. */
function uniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === "object" && current !== null; depth++) {
    const e = current as { code?: unknown; cause?: unknown };
    if (e.code === UNIQUE_VIOLATION) return true;
    current = e.cause;
  }
  return false;
}

/** What a goal holds right now: the sum of its entries (can't go below 0 through the actions). */
export async function goalHolds(tx: Executor | typeof dbClient, userId: string, goalId: string): Promise<number> {
  const [row] = await tx
    .select({ sum: sql<string>`coalesce(sum(${savingsGoalContributions.amountCents}), 0)::text` })
    .from(savingsGoalContributions)
    .where(and(eq(savingsGoalContributions.goalId, goalId), eq(savingsGoalContributions.userId, userId)));
  return Number(row?.sum ?? 0);
}

async function ownsAccount(tx: Executor, userId: string, accountId: string): Promise<boolean> {
  const [owned] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  return owned !== undefined;
}

/** Creates a goal that holds nothing yet; its plan starts today. */
export async function createGoal(
  database: typeof dbClient,
  userId: string,
  input: GoalInput,
  today: string,
): Promise<GoalWriteResult> {
  try {
    return await database.transaction(async (tx): Promise<GoalWriteResult> => {
      if (input.source.kind === "account" && !(await ownsAccount(tx, userId, input.source.accountId))) {
        return { ok: false, error: "accountNotFound" };
      }
      const [goal] = await tx
        .insert(savingsGoals)
        .values({
          userId,
          name: input.name,
          targetCents: input.targetCents,
          targetDate: input.targetDate,
          icon: input.icon,
          accountId: input.source.kind === "account" ? input.source.accountId : null,
          startCents: 0,
          startDate: today,
        })
        .returning({ id: savingsGoals.id });
      return { ok: true, id: goal.id };
    });
  } catch (error) {
    if (uniqueViolation(error)) return { ok: false, error: "nameTaken" };
    throw error;
  }
}

/**
 * Updates a goal. Changing the target, date or account restarts the plan from what the goal holds, so an
 * edit never makes the goal look behind for months that already passed. The account (or manual) can only
 * change while the goal holds nothing; its (zero-sum) entries are dropped and rules pointing at it cleared.
 */
export async function updateGoal(
  database: typeof dbClient,
  userId: string,
  goalId: string,
  input: GoalInput,
  today: string,
): Promise<GoalWriteResult> {
  try {
    return await database.transaction(async (tx): Promise<GoalWriteResult> => {
      const [current] = await tx
        .select()
        .from(savingsGoals)
        .where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.userId, userId)))
        .for("update");
      if (!current) return { ok: false, error: "notFound" };

      const accountId = input.source.kind === "account" ? input.source.accountId : null;
      const accountChanged = current.accountId !== accountId;
      if (accountChanged) {
        if (accountId !== null && !(await ownsAccount(tx, userId, accountId))) return { ok: false, error: "accountNotFound" };
        if ((await goalHolds(tx, userId, goalId)) !== 0) return { ok: false, error: "notEmpty" };
        await tx
          .delete(savingsGoalContributions)
          .where(and(eq(savingsGoalContributions.goalId, goalId), eq(savingsGoalContributions.userId, userId)));
        await tx
          .update(savingsRules)
          .set({ goalId: null })
          .where(and(eq(savingsRules.goalId, goalId), eq(savingsRules.userId, userId)));
      }
      const planChanged =
        current.targetCents !== input.targetCents || current.targetDate !== input.targetDate || accountChanged;
      const holds = await goalHolds(tx, userId, goalId);

      await tx
        .update(savingsGoals)
        .set({
          name: input.name,
          targetCents: input.targetCents,
          targetDate: input.targetDate,
          icon: input.icon,
          accountId,
          updatedAt: new Date(),
          ...(planChanged ? { startCents: Math.max(0, holds), startDate: today } : {}),
        })
        .where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.userId, userId)));
      return { ok: true, id: goalId };
    });
  } catch (error) {
    if (uniqueViolation(error)) return { ok: false, error: "nameTaken" };
    throw error;
  }
}

/** The goal's current target date, to allow keeping a past one when editing. Null if not found. */
export async function getGoalTargetDate(
  database: typeof dbClient,
  userId: string,
  goalId: string,
): Promise<{ targetDate: string | null } | null> {
  const [row] = await database
    .select({ targetDate: savingsGoals.targetDate })
    .from(savingsGoals)
    .where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.userId, userId)));
  return row ?? null;
}

export type GoalDeleteResult = { ok: true; snapshot: GoalSnapshot } | { ok: false; error: "notFound" };

/** Deletes a goal (its entries go with it) and returns what Undo needs to bring it back. */
export async function deleteGoal(
  database: typeof dbClient,
  userId: string,
  goalId: string,
): Promise<GoalDeleteResult> {
  return database.transaction(async (tx): Promise<GoalDeleteResult> => {
    const [goal] = await tx
      .select()
      .from(savingsGoals)
      .where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.userId, userId)));
    if (!goal) return { ok: false, error: "notFound" };
    const contributions = await tx
      .select()
      .from(savingsGoalContributions)
      .where(and(eq(savingsGoalContributions.goalId, goalId), eq(savingsGoalContributions.userId, userId)))
      .orderBy(asc(savingsGoalContributions.createdAt), asc(savingsGoalContributions.id));
    // The FK clears their goal on delete; Undo puts it back.
    const rules = await tx
      .select({ id: savingsRules.id })
      .from(savingsRules)
      .where(and(eq(savingsRules.goalId, goalId), eq(savingsRules.userId, userId)));
    await tx.delete(savingsGoals).where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.userId, userId)));
    return {
      ok: true,
      snapshot: {
        goal: {
          id: goal.id,
          name: goal.name,
          targetCents: goal.targetCents,
          targetDate: goal.targetDate,
          icon: goal.icon,
          accountId: goal.accountId,
          startCents: goal.startCents,
          startDate: goal.startDate,
          createdAt: goal.createdAt.toISOString(),
        },
        contributions: contributions.map((c) => ({
          id: c.id,
          date: c.date,
          amountCents: c.amountCents,
          transactionId: c.transactionId,
          createdAt: c.createdAt.toISOString(),
        })),
        ruleIds: rules.map((r) => r.id),
      },
    };
  });
}

/**
 * Undo of `deleteGoal`: recreates the goal and its entries with their old ids in one transaction. Refuses
 * when the account is gone or not the user's, when the name is taken again, or when the id is already in
 * use. An entry that followed a moved row comes back only if that row still sits on the goal's account and
 * no other goal took it. `snapshot` must already be validated (lib/goals/snapshot).
 */
export async function restoreGoal(
  database: typeof dbClient,
  userId: string,
  snapshot: GoalSnapshot,
): Promise<GoalWriteResult> {
  const { goal, contributions, ruleIds } = snapshot;
  try {
    return await database.transaction(async (tx): Promise<GoalWriteResult> => {
      if (goal.accountId !== null && !(await ownsAccount(tx, userId, goal.accountId))) {
        return { ok: false, error: "accountNotFound" };
      }
      const [inserted] = await tx
        .insert(savingsGoals)
        .values({ ...goal, userId, createdAt: new Date(goal.createdAt) })
        .onConflictDoNothing({ target: savingsGoals.id })
        .returning({ id: savingsGoals.id });
      // The id is in use already (restored twice, or someone else's).
      if (!inserted) return { ok: false, error: "notFound" };

      const movedIds = contributions.flatMap((c) => (c.transactionId ? [c.transactionId] : []));
      let free = new Set<string>();
      if (movedIds.length > 0 && goal.accountId !== null) {
        const rows = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, userId),
              eq(transactions.accountId, goal.accountId),
              inArray(transactions.id, movedIds),
              sql`NOT EXISTS (SELECT 1 FROM savings_goal_contributions c WHERE c.transaction_id = ${transactions.id} AND c.user_id = ${userId})`,
            ),
          );
        free = new Set(rows.map((r) => r.id));
      }
      const keep = contributions.filter((c) => c.transactionId === null || free.has(c.transactionId));
      if (keep.length > 0) {
        await tx
          .insert(savingsGoalContributions)
          .values(keep.map((c) => ({ ...c, userId, goalId: goal.id, createdAt: new Date(c.createdAt) })));
      }
      if (ruleIds.length > 0 && goal.accountId !== null) {
        await tx
          .update(savingsRules)
          .set({ goalId: goal.id })
          .where(
            and(
              eq(savingsRules.userId, userId),
              inArray(savingsRules.id, ruleIds),
              eq(savingsRules.accountId, goal.accountId),
              sql`${savingsRules.goalId} IS NULL`,
            ),
          );
      }
      return { ok: true, id: goal.id };
    });
  } catch (error) {
    if (uniqueViolation(error)) return { ok: false, error: "nameTaken" };
    throw error;
  }
}

export type ContributionError = "notFound" | "notManual" | "exceedsSaved";

/**
 * Adds money to (positive) or takes it out of (negative) a goal tracked by hand. Taking out more than
 * the goal holds is refused. The goal row is locked so two withdrawals can't both pass.
 */
export async function addContribution(
  database: typeof dbClient,
  userId: string,
  goalId: string,
  entry: { amountCents: number; date: string },
): Promise<{ ok: true } | { ok: false; error: ContributionError }> {
  return database.transaction(async (tx) => {
    const [goal] = await tx
      .select({ accountId: savingsGoals.accountId })
      .from(savingsGoals)
      .where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.userId, userId)))
      .for("update");
    if (!goal) return { ok: false, error: "notFound" };
    if (goal.accountId !== null) return { ok: false, error: "notManual" };

    if (entry.amountCents < 0 && (await goalHolds(tx, userId, goalId)) + entry.amountCents < 0) {
      return { ok: false, error: "exceedsSaved" };
    }
    await tx.insert(savingsGoalContributions).values({ userId, goalId, ...entry });
    return { ok: true };
  });
}

/** The account a goal lives in: `undefined` when it isn't the user's, null for a goal tracked by hand. */
export async function getGoalAccountId(
  database: typeof dbClient,
  userId: string,
  goalId: string,
): Promise<string | null | undefined> {
  const [row] = await database
    .select({ accountId: savingsGoals.accountId })
    .from(savingsGoals)
    .where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.userId, userId)));
  return row ? row.accountId : undefined;
}

export type AssignError = "notFound" | "notAccount" | "noBalance" | "exceedsNotAssigned" | "exceedsSaved";

/**
 * Assigns money to (positive) or takes it back from (negative) an account goal. Assigning is limited to the
 * account's Not assigned; taking back to what the goal holds. The goal and account rows are locked so two
 * requests can't both pass.
 */
export async function assignToGoal(
  database: typeof dbClient,
  userId: string,
  goalId: string,
  entry: { amountCents: number; date: string },
): Promise<{ ok: true } | { ok: false; error: AssignError }> {
  return database.transaction(async (tx) => {
    const [goal] = await tx
      .select({ accountId: savingsGoals.accountId })
      .from(savingsGoals)
      .where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.userId, userId)))
      .for("update");
    if (!goal) return { ok: false, error: "notFound" };
    if (goal.accountId === null) return { ok: false, error: "notAccount" };
    // Serializes assignments on one account (the goal lock only covers one goal).
    await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, goal.accountId), eq(accounts.userId, userId))).for("update");

    if (entry.amountCents > 0) {
      const sameAccount = await tx
        .select({ accountId: savingsGoals.accountId, id: savingsGoals.id })
        .from(savingsGoals)
        .where(and(eq(savingsGoals.userId, userId), eq(savingsGoals.accountId, goal.accountId)));
      const goals = await Promise.all(
        sameAccount.map(async (g) => ({ accountId: g.accountId, savedCents: await goalHolds(tx, userId, g.id) })),
      );
      const balances = await getAccountBalances(tx, userId);
      const money = goalMoneyByAccount(goals, balances).get(goal.accountId);
      const error = canAssign(money, entry.amountCents);
      if (error) return { ok: false, error };
    } else if ((await goalHolds(tx, userId, goalId)) + entry.amountCents < 0) {
      return { ok: false, error: "exceedsSaved" };
    }
    await tx.insert(savingsGoalContributions).values({ userId, goalId, ...entry });
    return { ok: true };
  });
}

export type MoveBetweenGoalsError = "notFound" | "notSameAccount" | "exceedsSaved";

/** Moves assigned money from one goal to another goal of the same account. */
export async function moveBetweenGoals(
  database: typeof dbClient,
  userId: string,
  input: { fromGoalId: string; toGoalId: string; amountCents: number; date: string },
): Promise<{ ok: true } | { ok: false; error: MoveBetweenGoalsError }> {
  return database.transaction(async (tx) => {
    if (input.fromGoalId === input.toGoalId) return { ok: false, error: "notSameAccount" };
    const goals = await tx
      .select({ id: savingsGoals.id, accountId: savingsGoals.accountId })
      .from(savingsGoals)
      .where(and(eq(savingsGoals.userId, userId), inArray(savingsGoals.id, [input.fromGoalId, input.toGoalId])))
      .orderBy(asc(savingsGoals.id))
      .for("update");
    if (goals.length !== 2) return { ok: false, error: "notFound" };
    if (goals[0].accountId === null || goals[0].accountId !== goals[1].accountId) return { ok: false, error: "notSameAccount" };
    if ((await goalHolds(tx, userId, input.fromGoalId)) < input.amountCents) return { ok: false, error: "exceedsSaved" };
    await tx.insert(savingsGoalContributions).values([
      { userId, goalId: input.fromGoalId, date: input.date, amountCents: -input.amountCents },
      { userId, goalId: input.toGoalId, date: input.date, amountCents: input.amountCents },
    ]);
    return { ok: true };
  });
}

/** Removes an entry. Refused when the goal would hold less than nothing. */
export async function deleteContribution(
  database: typeof dbClient,
  userId: string,
  contributionId: string,
): Promise<{ ok: true } | { ok: false; error: "notFound" | "exceedsSaved" }> {
  return database.transaction(async (tx) => {
    const [entry] = await tx
      .select({ goalId: savingsGoalContributions.goalId, amountCents: savingsGoalContributions.amountCents })
      .from(savingsGoalContributions)
      .where(and(eq(savingsGoalContributions.id, contributionId), eq(savingsGoalContributions.userId, userId)));
    if (!entry) return { ok: false, error: "notFound" };
    await tx
      .select({ id: savingsGoals.id })
      .from(savingsGoals)
      .where(and(eq(savingsGoals.id, entry.goalId), eq(savingsGoals.userId, userId)))
      .for("update");
    if ((await goalHolds(tx, userId, entry.goalId)) - entry.amountCents < 0) return { ok: false, error: "exceedsSaved" };
    await tx
      .delete(savingsGoalContributions)
      .where(and(eq(savingsGoalContributions.id, contributionId), eq(savingsGoalContributions.userId, userId)));
    return { ok: true };
  });
}
