import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";

import type { LedgerCheckpoint, LedgerPayment, PaymentSplit } from "../../lib/loans/ledger";
import type { LoanFormValues } from "../../lib/loans/input";
import type { db as dbClient } from "../client";
import { accounts, loanCheckpoints, loanPaymentSplits, loans, recurring, transactions, type Loan } from "../schema";
import { isUniqueViolation } from "./accounts";
import { listRecurring } from "./recurring";

type Database = typeof dbClient;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type LoanWriteError =
  | "nameTaken"
  | "notFound"
  | "paymentNotFound"
  | "startConflict"
  | "beforeStart"
  | "isStart"
  | "notAPayment"
  | "tooHigh";

export interface LoanPayment extends LedgerPayment {
  accountName: string;
}

/** The regular payment that pays a loan, as the regular payments list shows it. */
export interface LoanPaymentItem {
  id: string;
  name: string;
  typicalAmountCents: number;
  nextExpectedDate: string | null;
  accountName: string;
}

export interface LoanData {
  loan: Loan;
  checkpoints: Array<LedgerCheckpoint & { id: string }>;
  payments: LoanPayment[];
  splits: Map<string, PaymentSplit>;
  item: LoanPaymentItem | null;
}

/**
 * The user's loans (oldest first) with everything the pure functions need: checkpoints, the bank rows linked to
 * the loan's regular payment (outflows, not ignored), the user's own splits and the regular payment itself.
 * Every read is scoped by `user_id`. `loanId` narrows it to one loan.
 */
export async function listLoans(database: Database, userId: string, loanId?: string): Promise<LoanData[]> {
  const rows = await database
    .select()
    .from(loans)
    .where(and(eq(loans.userId, userId), loanId ? eq(loans.id, loanId) : undefined))
    .orderBy(asc(loans.createdAt), asc(loans.id));
  if (rows.length === 0) return [];
  const ids = rows.map((l) => l.id);
  const recurringIds = rows.flatMap((l) => (l.recurringId ? [l.recurringId] : []));

  const [checkpointRows, splitRows, paymentRows, items] = await Promise.all([
    database
      .select({ id: loanCheckpoints.id, loanId: loanCheckpoints.loanId, date: loanCheckpoints.date, owedCents: loanCheckpoints.owedCents })
      .from(loanCheckpoints)
      .where(and(eq(loanCheckpoints.userId, userId), inArray(loanCheckpoints.loanId, ids)))
      .orderBy(asc(loanCheckpoints.date)),
    database
      .select()
      .from(loanPaymentSplits)
      .where(and(eq(loanPaymentSplits.userId, userId), inArray(loanPaymentSplits.loanId, ids))),
    recurringIds.length === 0
      ? Promise.resolve([])
      : database
          .select({
            recurringId: transactions.recurringId,
            transactionId: transactions.id,
            date: transactions.date,
            amountCents: transactions.amountCents,
            accountName: accounts.name,
          })
          .from(transactions)
          .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.userId, userId)))
          .where(
            and(
              eq(transactions.userId, userId),
              inArray(transactions.recurringId, recurringIds),
              lt(transactions.amountCents, 0),
              sql`${transactions.ignoredAt} IS NULL`,
            ),
          ),
    recurringIds.length === 0 ? Promise.resolve([]) : listRecurring(database, userId, { includeEnded: true }),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));

  return rows.map((loan) => {
    const item = loan.recurringId ? itemById.get(loan.recurringId) : undefined;
    return {
      loan,
      checkpoints: checkpointRows.filter((c) => c.loanId === loan.id),
      payments: paymentRows
        .filter((p) => p.recurringId === loan.recurringId)
        .map(({ transactionId, date, amountCents, accountName }) => ({ transactionId, date, amountCents, accountName })),
      splits: new Map(
        splitRows.filter((s) => s.loanId === loan.id).map((s) => [s.transactionId, { interestCents: s.interestCents, insuranceCents: s.insuranceCents }]),
      ),
      item: item
        ? { id: item.id, name: item.name, typicalAmountCents: item.typicalAmountCents, nextExpectedDate: item.nextExpectedDate, accountName: item.accountName }
        : null,
    };
  });
}

export async function getLoan(database: Database, userId: string, loanId: string): Promise<LoanData | null> {
  return (await listLoans(database, userId, loanId))[0] ?? null;
}

/** Confirmed regular outflows: what a loan can be paid by. */
export async function listLoanPaymentChoices(database: Database, userId: string): Promise<LoanPaymentItem[]> {
  const items = await listRecurring(database, userId);
  return items
    .filter((i) => i.status === "confirmed" && i.typicalAmountCents < 0)
    .map((i) => ({ id: i.id, name: i.name, typicalAmountCents: i.typicalAmountCents, nextExpectedDate: i.nextExpectedDate, accountName: i.accountName }));
}

async function isPayingItem(tx: Tx, userId: string, recurringId: string): Promise<boolean> {
  const [item] = await tx
    .select({ id: recurring.id })
    .from(recurring)
    .where(and(eq(recurring.id, recurringId), eq(recurring.userId, userId), eq(recurring.status, "confirmed"), lt(recurring.typicalAmountCents, 0)));
  return item !== undefined;
}

function loanColumns(values: LoanFormValues) {
  return {
    name: values.name,
    borrowedCents: values.borrowed,
    rateThousandths: values.rate,
    insuranceCents: values.insuranceCents,
    insuranceRateThousandths: values.insuranceRateThousandths,
    lastPaymentOn: values.lastPaymentOn,
    currentPaymentUntil: values.currentPaymentUntil,
    startedOn: values.startedOn,
    amortizationFrom: values.amortizationFrom,
    recurringId: values.recurringId,
  };
}

export type CreateLoanResult = { ok: true; loanId: string } | { ok: false; error: LoanWriteError };

/** Inserts the loan and its first checkpoint (the capital owed at the start of `owedOn`) in one transaction. */
export async function createLoan(database: Database, userId: string, values: LoanFormValues): Promise<CreateLoanResult> {
  try {
    return await database.transaction(async (tx): Promise<CreateLoanResult> => {
      if (values.recurringId && !(await isPayingItem(tx, userId, values.recurringId))) return { ok: false, error: "paymentNotFound" };
      const [loan] = await tx.insert(loans).values({ userId, ...loanColumns(values) }).returning({ id: loans.id });
      await tx.insert(loanCheckpoints).values({ userId, loanId: loan.id, date: values.owedOn, owedCents: values.owed });
      return { ok: true, loanId: loan.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "nameTaken" };
    throw error;
  }
}

export type SimpleLoanResult = { ok: true } | { ok: false; error: LoanWriteError };

/** Edits the loan's terms and its first checkpoint. Corrections stay, so the new start must come before them. */
export async function updateLoan(database: Database, userId: string, loanId: string, values: LoanFormValues): Promise<SimpleLoanResult> {
  try {
    return await database.transaction(async (tx): Promise<SimpleLoanResult> => {
      const [existing] = await tx.select({ id: loans.id }).from(loans).where(and(eq(loans.id, loanId), eq(loans.userId, userId))).for("update");
      if (!existing) return { ok: false, error: "notFound" };
      if (values.recurringId && !(await isPayingItem(tx, userId, values.recurringId))) return { ok: false, error: "paymentNotFound" };
      const checkpoints = await tx
        .select()
        .from(loanCheckpoints)
        .where(and(eq(loanCheckpoints.loanId, loanId), eq(loanCheckpoints.userId, userId)))
        .orderBy(asc(loanCheckpoints.date));
      const [start, ...later] = checkpoints;
      if (later.some((c) => c.date <= values.owedOn)) return { ok: false, error: "startConflict" };
      await tx.update(loans).set(loanColumns(values)).where(and(eq(loans.id, loanId), eq(loans.userId, userId)));
      await tx
        .update(loanCheckpoints)
        .set({ date: values.owedOn, owedCents: values.owed })
        .where(and(eq(loanCheckpoints.id, start.id), eq(loanCheckpoints.userId, userId)));
      return { ok: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "nameTaken" };
    throw error;
  }
}

export interface LoanSnapshot {
  loan: Loan;
  checkpoints: Array<{ id: string; date: string; owedCents: number }>;
  splits: Array<{ transactionId: string; interestCents: number; insuranceCents: number }>;
}

/** Deletes a loan (its checkpoints and splits go with it) and returns what Undo needs. The bank's rows are never touched. */
export async function deleteLoan(database: Database, userId: string, loanId: string): Promise<LoanSnapshot | null> {
  return database.transaction(async (tx) => {
    const [loan] = await tx.select().from(loans).where(and(eq(loans.id, loanId), eq(loans.userId, userId))).for("update");
    if (!loan) return null;
    const checkpoints = await tx
      .select({ id: loanCheckpoints.id, date: loanCheckpoints.date, owedCents: loanCheckpoints.owedCents })
      .from(loanCheckpoints)
      .where(and(eq(loanCheckpoints.loanId, loanId), eq(loanCheckpoints.userId, userId)));
    const splits = await tx
      .select({ transactionId: loanPaymentSplits.transactionId, interestCents: loanPaymentSplits.interestCents, insuranceCents: loanPaymentSplits.insuranceCents })
      .from(loanPaymentSplits)
      .where(and(eq(loanPaymentSplits.loanId, loanId), eq(loanPaymentSplits.userId, userId)));
    await tx.delete(loans).where(and(eq(loans.id, loanId), eq(loans.userId, userId)));
    return { loan, checkpoints, splits };
  });
}

/** Undo of `deleteLoan`: puts the loan back with the same id. A regular payment or row that is gone meanwhile is dropped. */
export async function restoreLoan(database: Database, userId: string, snapshot: LoanSnapshot): Promise<SimpleLoanResult> {
  if (snapshot.loan.userId !== userId) return { ok: false, error: "notFound" };
  try {
    return await database.transaction(async (tx): Promise<SimpleLoanResult> => {
      const recurringId = snapshot.loan.recurringId && (await isPayingItem(tx, userId, snapshot.loan.recurringId)) ? snapshot.loan.recurringId : null;
      await tx.insert(loans).values({ ...snapshot.loan, userId, recurringId });
      if (snapshot.checkpoints.length > 0) await tx.insert(loanCheckpoints).values(snapshot.checkpoints.map((c) => ({ ...c, userId, loanId: snapshot.loan.id })));
      const txIds = snapshot.splits.map((s) => s.transactionId);
      const existing = txIds.length === 0 ? [] : await tx.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.id, txIds)));
      const alive = new Set(existing.map((r) => r.id));
      const splits = snapshot.splits.filter((s) => alive.has(s.transactionId));
      if (splits.length > 0) await tx.insert(loanPaymentSplits).values(splits.map((s) => ({ ...s, userId, loanId: snapshot.loan.id })));
      return { ok: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "nameTaken" };
    throw error;
  }
}

/** "The bank says I owe X at the start of this day." Replaces an earlier correction of the same day. */
export async function addLoanCorrection(database: Database, userId: string, loanId: string, input: { date: string; owedCents: number }): Promise<SimpleLoanResult> {
  return database.transaction(async (tx): Promise<SimpleLoanResult> => {
    const [loan] = await tx.select({ id: loans.id }).from(loans).where(and(eq(loans.id, loanId), eq(loans.userId, userId))).for("update");
    if (!loan) return { ok: false, error: "notFound" };
    const [start] = await tx
      .select({ date: loanCheckpoints.date })
      .from(loanCheckpoints)
      .where(and(eq(loanCheckpoints.loanId, loanId), eq(loanCheckpoints.userId, userId)))
      .orderBy(asc(loanCheckpoints.date))
      .limit(1);
    if (!start || input.date <= start.date) return { ok: false, error: "beforeStart" };
    await tx
      .insert(loanCheckpoints)
      .values({ userId, loanId, date: input.date, owedCents: input.owedCents })
      .onConflictDoUpdate({ target: [loanCheckpoints.loanId, loanCheckpoints.date], set: { owedCents: input.owedCents } });
    return { ok: true };
  });
}

/** Removes a correction. The first checkpoint (the loan's start) can't be removed. */
export async function deleteLoanCorrection(database: Database, userId: string, checkpointId: string): Promise<SimpleLoanResult> {
  return database.transaction(async (tx): Promise<SimpleLoanResult> => {
    const [checkpoint] = await tx
      .select()
      .from(loanCheckpoints)
      .where(and(eq(loanCheckpoints.id, checkpointId), eq(loanCheckpoints.userId, userId)));
    if (!checkpoint) return { ok: false, error: "notFound" };
    const [earlier] = await tx
      .select({ id: loanCheckpoints.id })
      .from(loanCheckpoints)
      .where(and(eq(loanCheckpoints.loanId, checkpoint.loanId), eq(loanCheckpoints.userId, userId), lt(loanCheckpoints.date, checkpoint.date)))
      .limit(1);
    if (!earlier) return { ok: false, error: "isStart" };
    await tx.delete(loanCheckpoints).where(and(eq(loanCheckpoints.id, checkpointId), eq(loanCheckpoints.userId, userId)));
    return { ok: true };
  });
}

/** Sets the interest and insurance of one payment. The bank's total is the row's amount; capital is what is left. */
export async function setLoanPaymentSplit(
  database: Database,
  userId: string,
  loanId: string,
  transactionId: string,
  split: PaymentSplit,
): Promise<SimpleLoanResult> {
  return database.transaction(async (tx): Promise<SimpleLoanResult> => {
    const [row] = await tx
      .select({ amountCents: transactions.amountCents })
      .from(transactions)
      .innerJoin(loans, and(eq(loans.id, loanId), eq(loans.userId, userId), eq(loans.recurringId, transactions.recurringId)))
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId), lt(transactions.amountCents, 0)));
    if (!row) return { ok: false, error: "notAPayment" };
    if (split.interestCents + split.insuranceCents > -row.amountCents) return { ok: false, error: "tooHigh" };
    await tx
      .insert(loanPaymentSplits)
      .values({ userId, loanId, transactionId, ...split })
      .onConflictDoUpdate({ target: [loanPaymentSplits.loanId, loanPaymentSplits.transactionId], set: split });
    return { ok: true };
  });
}

export async function clearLoanPaymentSplit(database: Database, userId: string, loanId: string, transactionId: string): Promise<void> {
  await database
    .delete(loanPaymentSplits)
    .where(and(eq(loanPaymentSplits.userId, userId), eq(loanPaymentSplits.loanId, loanId), eq(loanPaymentSplits.transactionId, transactionId)));
}

/** The loan a bank row pays, if any (the row's regular payment is a loan's), for the transaction sheet. */
export async function getLoanForTransaction(database: Database, userId: string, transactionId: string): Promise<LoanData | null> {
  const [row] = await database
    .select({ loanId: loans.id })
    .from(transactions)
    .innerJoin(loans, and(eq(loans.userId, userId), eq(loans.recurringId, transactions.recurringId)))
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId), lte(transactions.amountCents, 0)))
    .limit(1);
  return row ? getLoan(database, userId, row.loanId) : null;
}
