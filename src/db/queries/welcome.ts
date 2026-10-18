import { and, eq, isNull, sql } from "drizzle-orm";

import type { db as dbClient } from "../client";
import { categoryBudgets, transactions, users } from "../schema";

export interface WelcomeFacts {
  /** Set once the checklist was finished or hidden; it never comes back. */
  completed: boolean;
  hasTransactions: boolean;
  hasBudget: boolean;
}

/** What the welcome checklist needs beyond what Home already loads. All scoped by user. */
export async function getWelcomeFacts(database: typeof dbClient, userId: string): Promise<WelcomeFacts> {
  const [user] = await database
    .select({ completedAt: users.welcomeCompletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const tx = await database.select({ id: transactions.id }).from(transactions).where(eq(transactions.userId, userId)).limit(1);
  const budget = await database
    .select({ id: categoryBudgets.categoryId })
    .from(categoryBudgets)
    .where(eq(categoryBudgets.userId, userId))
    .limit(1);
  return {
    completed: user?.completedAt != null,
    hasTransactions: tx.length > 0,
    hasBudget: budget.length > 0,
  };
}

/** Marks the checklist finished or hidden. Only the first call writes, so the date is when it happened. */
export async function markWelcomeCompleted(database: typeof dbClient, userId: string): Promise<void> {
  await database
    .update(users)
    .set({ welcomeCompletedAt: sql`now()` })
    .where(and(eq(users.id, userId), isNull(users.welcomeCompletedAt)));
}
