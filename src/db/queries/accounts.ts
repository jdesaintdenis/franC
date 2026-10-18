import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";

import { parseAccountName, type AccountNameError } from "../../lib/accounts/name";
import { db, type db as dbClient } from "../client";
import { accounts, bankAccountLinks, imports, savingsGoalContributions, transactions, users, type Account } from "../schema";

// Every query here must be scoped by userId — accounts are per-user data.
export async function listAccounts(userId: string): Promise<Account[]> {
  return db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(asc(accounts.createdAt));
}

/** Ownership check for server actions: filters on both id and userId. */
export async function getOwnedAccount(userId: string, accountId: string): Promise<Account | null> {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .limit(1);
  return account ?? null;
}

/** The account Home opens on, or null for all accounts. */
export async function getHomeAccountId(userId: string): Promise<string | null> {
  const [row] = await db.select({ id: users.homeAccountId }).from(users).where(eq(users.id, userId));
  return row?.id ?? null;
}

/** Sets (or clears, with null) the Home account. False when the account isn't the user's. */
export async function setHomeAccount(userId: string, accountId: string | null): Promise<boolean> {
  if (accountId !== null && !(await getOwnedAccount(userId, accountId))) return false;
  await db.update(users).set({ homeAccountId: accountId }).where(eq(users.id, userId));
  return true;
}

// --- Account management (Slice 15). These take the db handle like the other query modules. ---

export type AccountWriteError = AccountNameError | "nameTaken";

export type CreateAccountResult =
  | { ok: true; account: Account }
  | { ok: false; error: AccountWriteError };

export type RenameAccountResult =
  | { ok: true; account: Account }
  | { ok: false; error: AccountWriteError | "notFound" };

export type DeleteAccountResult =
  | { ok: true; imports: number; transactions: number }
  | { ok: false; error: "notFound" | "lastAccount" };

const UNIQUE_VIOLATION = "23505";

/** postgres-js errors may be wrapped by drizzle, so look at the cause chain too. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === "object" && current !== null; depth++) {
    if ("code" in current && (current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function createAccount(
  database: typeof dbClient,
  userId: string,
  name: string,
): Promise<CreateAccountResult> {
  const parsed = parseAccountName(name);
  if (!parsed.ok) return parsed;
  try {
    const [account] = await database.insert(accounts).values({ userId, name: parsed.name }).returning();
    return { ok: true, account };
  } catch (error) {
    // The unique index on (user_id, lower(name)) is the race-safe check.
    if (isUniqueViolation(error)) return { ok: false, error: "nameTaken" };
    throw error;
  }
}

export async function renameAccount(
  database: typeof dbClient,
  userId: string,
  accountId: string,
  name: string,
): Promise<RenameAccountResult> {
  const parsed = parseAccountName(name);
  if (!parsed.ok) return parsed;
  try {
    const [account] = await database
      .update(accounts)
      .set({ name: parsed.name })
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .returning();
    return account ? { ok: true, account } : { ok: false, error: "notFound" };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "nameTaken" };
    throw error;
  }
}

/**
 * Deletes an account; its imports, transactions and recurring items go with it
 * through the FK cascades. Refuses the user's last account. Callers should run
 * `refreshRecurring` afterwards so remaining items and links stay consistent.
 */
export async function deleteAccount(
  database: typeof dbClient,
  userId: string,
  accountId: string,
): Promise<DeleteAccountResult> {
  return database.transaction(async (tx) => {
    // Locking all of the user's accounts serializes concurrent deletes, so two
    // requests can't each see "another account remains" and delete both.
    const owned = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .for("update");
    if (!owned.some((a) => a.id === accountId)) return { ok: false, error: "notFound" };
    // Imports need somewhere to go, so the last current account stays; a Savings account never needs that.
    const current = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.savings, false)));
    if (current.length === 1 && current[0].id === accountId) return { ok: false, error: "lastAccount" };
    if (owned.length <= 1) return { ok: false, error: "lastAccount" };

    const [{ value: importCount }] = await tx
      .select({ value: count() })
      .from(imports)
      .where(and(eq(imports.accountId, accountId), eq(imports.userId, userId), ne(imports.kind, "franc")));
    const [{ value: transactionCount }] = await tx
      .select({ value: count() })
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.userId, userId)));

    // Keeps the goals' money: their entries stop following the rows that are about to go (FK cascade), and the
    // goals turn manual (FK set null) with the same total.
    await tx
      .update(savingsGoalContributions)
      .set({ transactionId: null })
      .where(
        and(
          eq(savingsGoalContributions.userId, userId),
          sql`${savingsGoalContributions.transactionId} IN (SELECT t.id FROM transactions t WHERE t.account_id = ${accountId} AND t.user_id = ${userId})`,
        ),
      );
    await tx.delete(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
    return { ok: true, imports: importCount, transactions: transactionCount };
  });
}

export interface AccountWithStats {
  id: string;
  name: string;
  createdAt: Date;
  transactionCount: number;
  importCount: number;
  lastImportAt: Date | null;
  /** A Savings account (Slice 52): no imports or bank sync, filled by "Move to savings". */
  savings: boolean;
  /** Rows franC created on this account when money was moved to it. */
  moveCount: number;
}

/** The user's accounts, oldest first, with what each holds. */
export async function listAccountsWithStats(
  database: typeof dbClient,
  userId: string,
): Promise<AccountWithStats[]> {
  // Correlated subqueries keep the two counts from multiplying each other.
  const rows = await database
    .select({
      id: accounts.id,
      name: accounts.name,
      createdAt: accounts.createdAt,
      savings: accounts.savings,
      moveCount: sql<number>`(select count(*)::int from transactions t where t.account_id = "accounts"."id" and t.user_id = "accounts"."user_id" and t.source = 'franc')`,
      transactionCount: sql<number>`(select count(*)::int from transactions t where t.account_id = "accounts"."id" and t.user_id = "accounts"."user_id")`,
      importCount: sql<number>`(select count(*)::int from imports i where i.account_id = "accounts"."id" and i.user_id = "accounts"."user_id" and i.kind <> 'franc')`,
      lastImportAt: sql<string | null>`(select max(i.uploaded_at) from imports i where i.account_id = "accounts"."id" and i.user_id = "accounts"."user_id" and i.kind <> 'franc')`,
    })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .orderBy(asc(accounts.createdAt), asc(accounts.id));

  return rows.map((r) => ({
    ...r,
    lastImportAt: r.lastImportAt === null ? null : new Date(r.lastImportAt),
  }));
}

/** Account of the user's most recent import, or null when there are none. */
export async function getLastUsedAccountId(
  database: typeof dbClient,
  userId: string,
): Promise<string | null> {
  const [row] = await database
    .select({ accountId: imports.accountId })
    .from(imports)
    .where(and(eq(imports.userId, userId), ne(imports.kind, "franc")))
    .orderBy(desc(imports.uploadedAt), desc(imports.id))
    .limit(1);
  return row?.accountId ?? null;
}

export type SetAccountSavingsResult =
  | { ok: true }
  | { ok: false; error: "notFound" | "hasImports" | "hasManual" | "hasMoves" | "lastCurrent" };

/**
 * Switches an account between Current and Savings. To Savings is refused once the account has an import or a
 * bank link (a Savings account takes neither) or when it is the user's only current account; it also takes the
 * account out of safe to spend (the user can put it back). Back to Current is refused while it holds moves, so
 * a current account never holds rows franC created. One transaction, the user's accounts locked.
 */
export async function setAccountSavings(
  database: typeof dbClient,
  userId: string,
  accountId: string,
  savings: boolean,
): Promise<SetAccountSavingsResult> {
  return database.transaction(async (tx) => {
    const owned = await tx
      .select({ id: accounts.id, savings: accounts.savings })
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .for("update");
    const account = owned.find((a) => a.id === accountId);
    if (!account) return { ok: false, error: "notFound" };
    if (account.savings === savings) return { ok: true };

    if (savings) {
      if (owned.filter((a) => !a.savings).length <= 1) return { ok: false, error: "lastCurrent" };
      const [{ value: imported }] = await tx
        .select({ value: count() })
        .from(imports)
        .where(and(eq(imports.accountId, accountId), eq(imports.userId, userId), ne(imports.kind, "franc")));
      const [{ value: linked }] = await tx
        .select({ value: count() })
        .from(bankAccountLinks)
        .where(and(eq(bankAccountLinks.accountId, accountId), eq(bankAccountLinks.userId, userId)));
      if (imported > 0 || linked > 0) return { ok: false, error: "hasImports" };
      const [{ value: manual }] = await tx
        .select({ value: count() })
        .from(transactions)
        .where(and(eq(transactions.accountId, accountId), eq(transactions.userId, userId), eq(transactions.source, "manual")));
      if (manual > 0) return { ok: false, error: "hasManual" };
      await tx
        .update(accounts)
        .set({ savings: true, inSafeToSpend: false })
        .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
      return { ok: true };
    }

    const [{ value: moves }] = await tx
      .select({ value: count() })
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.userId, userId), eq(transactions.source, "franc")));
    if (moves > 0) return { ok: false, error: "hasMoves" };
    await tx
      .update(accounts)
      .set({ savings: false })
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
    return { ok: true };
  });
}

/** The hidden import that holds the rows franC creates (Savings moves) or that are added by hand; created on first use. */
export async function getFrancImportId(
  database: Pick<typeof dbClient, "select" | "insert">,
  userId: string,
  accountId: string,
): Promise<string> {
  const [existing] = await database
    .select({ id: imports.id })
    .from(imports)
    .where(and(eq(imports.userId, userId), eq(imports.accountId, accountId), eq(imports.kind, "franc")))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await database
    .insert(imports)
    .values({ userId, accountId, filename: "franC", kind: "franc" })
    .returning({ id: imports.id });
  return created.id;
}
