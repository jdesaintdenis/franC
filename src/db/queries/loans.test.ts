// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { loanFormSchema } from "../../lib/loans/input";
import { loanView } from "../../lib/loans/view";
import { db } from "../client";
import { imports, loanCheckpoints, loanPaymentSplits, loans, recurring, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { listAccounts } from "./accounts";
import {
  addLoanCorrection,
  clearLoanPaymentSplit,
  createLoan,
  deleteLoan,
  deleteLoanCorrection,
  getLoan,
  getLoanForTransaction,
  listLoanPaymentChoices,
  listLoans,
  restoreLoan,
  setLoanPaymentSplit,
  updateLoan,
} from "./loans";
import { provisionUserDefaults } from "./provision";

let counter = 0;

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [account] = await listAccounts(user.id);
  const [imp] = await db.insert(imports).values({ userId: user.id, accountId: account.id, filename: "x.csv", rowsTotal: 0, rowsError: 0 }).returning();
  const [item] = await db
    .insert(recurring)
    .values({
      userId: user.id,
      accountId: account.id,
      merchantKey: `loan-${counter++}`,
      typicalAmountCents: -20_000,
      interval: "monthly",
      lastSeenDate: "2026-03-05",
      nextExpectedDate: "2026-04-05",
      status: "confirmed",
    })
    .returning();
  const addRow = async (date: string, cents: number, recurringId: string | null = item.id) => {
    const [row] = await db
      .insert(transactions)
      .values({
        userId: user.id,
        accountId: account.id,
        importId: imp.id,
        date,
        amountCents: -cents,
        labelRaw: "PRLV LOAN",
        labelNormalized: "PRLV LOAN",
        labelDisplay: "PRLV LOAN",
        dedupeHash: `l${counter++}`,
        occurrenceIndex: 0,
        recurringId,
      })
      .returning({ id: transactions.id });
    return row.id;
  };
  return { user, account, item, addRow };
}

const form = (patch: Record<string, string> = {}) =>
  loanFormSchema("2026-12-31").parse({
    name: "Crédit auto",
    borrowed: "20 000",
    owed: "10 000",
    owedOn: "2026-01-01",
    rate: "1,2",
    insuranceMode: "amount",
    insurance: "5",
    lastPaymentOn: "2027-12-05",
    currentPaymentUntil: "",
    startedOn: "",
    amortizationFrom: "",
    recurringId: "",
    ...patch,
  });

describe("loans", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a loan with its first checkpoint and reads it back with the linked payments", async () => {
    const { user, item, addRow } = await setup();
    await addRow("2026-02-05", 20_000);
    await addRow("2026-03-05", 19_500);
    const created = await createLoan(db, user.id, form({ recurringId: item.id }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const data = await getLoan(db, user.id, created.loanId);
    expect(data?.checkpoints).toEqual([expect.objectContaining({ date: "2026-01-01", owedCents: 1_000_000 })]);
    expect(data?.payments.map((p) => p.amountCents)).toEqual(expect.arrayContaining([-20_000, -19_500]));
    expect(data?.item?.nextExpectedDate).toBe("2026-04-05");
    const view = loanView({ ...data!, item: data!.item }, "2026-03-20");
    expect(view.owedCents).toBeLessThan(1_000_000);
  });

  it("keeps the subscription and capital start dates through create, update and restore", async () => {
    const { user, item } = await setup();
    const created = await createLoan(db, user.id, form({ recurringId: item.id, startedOn: "2025-01-05", amortizationFrom: "2025-07-05" }));
    if (!created.ok) throw new Error("create");
    expect((await getLoan(db, user.id, created.loanId))?.loan).toMatchObject({ startedOn: "2025-01-05", amortizationFrom: "2025-07-05" });
    expect(await updateLoan(db, user.id, created.loanId, form({ recurringId: item.id, startedOn: "2025-02-05" }))).toEqual({ ok: true });
    expect((await getLoan(db, user.id, created.loanId))?.loan).toMatchObject({ startedOn: "2025-02-05", amortizationFrom: null });
    const snapshot = await deleteLoan(db, user.id, created.loanId);
    expect(snapshot).not.toBeNull();
    expect(await restoreLoan(db, user.id, snapshot!)).toEqual({ ok: true });
    expect((await getLoan(db, user.id, created.loanId))?.loan.startedOn).toBe("2025-02-05");
  });

  it("returns payments dated before the first checkpoint for the history", async () => {
    const { user, item, addRow } = await setup();
    await addRow("2025-12-05", 20_000);
    const created = await createLoan(db, user.id, form({ recurringId: item.id, startedOn: "2025-01-05" }));
    if (!created.ok) throw new Error("create");
    const data = await getLoan(db, user.id, created.loanId);
    expect(data?.payments.map((p) => p.date)).toContain("2025-12-05");
    expect(loanView(data!, "2026-03-20").history.some((e) => e.kind === "payment")).toBe(true);
  });

  it("writes nothing to transactions and leaves the bank rows alone", async () => {
    const { user, item, addRow } = await setup();
    const id = await addRow("2026-02-05", 20_000);
    const before = await db.select().from(transactions);
    await createLoan(db, user.id, form({ recurringId: item.id }));
    expect(await db.select().from(transactions)).toEqual(before);
    expect(before.map((r) => r.id)).toContain(id);
  });

  it("leaves out ignored rows and refund rows", async () => {
    const { user, item, addRow } = await setup();
    const ignored = await addRow("2026-02-05", 20_000);
    await db.update(transactions).set({ ignoredAt: new Date() }).where(eq(transactions.id, ignored));
    const refund = await addRow("2026-03-05", 20_000);
    await db.update(transactions).set({ amountCents: 500 }).where(eq(transactions.id, refund));
    const created = await createLoan(db, user.id, form({ recurringId: item.id }));
    if (!created.ok) throw new Error("create");
    expect((await getLoan(db, user.id, created.loanId))?.payments).toEqual([]);
  });

  it("refuses a regular payment that isn't the user's, confirmed or an outflow", async () => {
    const a = await setup();
    const b = await setup();
    expect(await createLoan(db, a.user.id, form({ recurringId: b.item.id }))).toEqual({ ok: false, error: "paymentNotFound" });
    await db.update(recurring).set({ status: "detected" }).where(eq(recurring.id, a.item.id));
    expect(await createLoan(db, a.user.id, form({ recurringId: a.item.id }))).toEqual({ ok: false, error: "paymentNotFound" });
    expect(await listLoanPaymentChoices(db, a.user.id)).toEqual([]);
  });

  it("lists confirmed regular outflows as choices", async () => {
    const { user, item } = await setup();
    expect(await listLoanPaymentChoices(db, user.id)).toEqual([expect.objectContaining({ id: item.id, typicalAmountCents: -20_000 })]);
  });

  it("refuses a second loan with the same name, ignoring case", async () => {
    const { user } = await setup();
    await createLoan(db, user.id, form());
    expect(await createLoan(db, user.id, form({ name: "crédit AUTO" }))).toEqual({ ok: false, error: "nameTaken" });
  });

  it("never shows or touches another user's loan", async () => {
    const a = await setup();
    const b = await setup();
    const created = await createLoan(db, a.user.id, form());
    if (!created.ok) throw new Error("create");
    const id = created.loanId;
    expect(await getLoan(db, b.user.id, id)).toBeNull();
    expect(await listLoans(db, b.user.id)).toEqual([]);
    expect(await updateLoan(db, b.user.id, id, form())).toEqual({ ok: false, error: "notFound" });
    expect(await deleteLoan(db, b.user.id, id)).toBeNull();
    expect(await addLoanCorrection(db, b.user.id, id, { date: "2026-03-01", owedCents: 1 })).toEqual({ ok: false, error: "notFound" });
    expect(await setLoanPaymentSplit(db, b.user.id, id, "00000000-0000-4000-8000-000000000000", { interestCents: 1, insuranceCents: 1 })).toEqual({ ok: false, error: "notAPayment" });
    expect(await getLoan(db, a.user.id, id)).not.toBeNull();
  });

  it("updates the terms and the first checkpoint, keeping corrections after the new start", async () => {
    const { user } = await setup();
    const created = await createLoan(db, user.id, form());
    if (!created.ok) throw new Error("create");
    await addLoanCorrection(db, user.id, created.loanId, { date: "2026-06-01", owedCents: 900_000 });

    expect(await updateLoan(db, user.id, created.loanId, form({ owed: "9 500", owedOn: "2026-02-01", name: "Auto" }))).toEqual({ ok: true });
    const data = await getLoan(db, user.id, created.loanId);
    expect(data?.loan.name).toBe("Auto");
    expect(data?.checkpoints.map((c) => [c.date, c.owedCents])).toEqual([["2026-02-01", 950_000], ["2026-06-01", 900_000]]);
    expect(await updateLoan(db, user.id, created.loanId, form({ owedOn: "2026-06-01" }))).toEqual({ ok: false, error: "startConflict" });
  });

  it("adds, replaces and removes corrections, but never the start", async () => {
    const { user } = await setup();
    const created = await createLoan(db, user.id, form());
    if (!created.ok) throw new Error("create");
    const id = created.loanId;
    expect(await addLoanCorrection(db, user.id, id, { date: "2026-01-01", owedCents: 5 })).toEqual({ ok: false, error: "beforeStart" });
    await addLoanCorrection(db, user.id, id, { date: "2026-06-01", owedCents: 900_000 });
    await addLoanCorrection(db, user.id, id, { date: "2026-06-01", owedCents: 880_000 });
    const rows = await db.select().from(loanCheckpoints).where(eq(loanCheckpoints.loanId, id));
    expect(rows).toHaveLength(2);
    const correction = rows.find((r) => r.date === "2026-06-01")!;
    expect(correction.owedCents).toBe(880_000);
    const start = rows.find((r) => r.date === "2026-01-01")!;
    expect(await deleteLoanCorrection(db, user.id, start.id)).toEqual({ ok: false, error: "isStart" });
    expect(await deleteLoanCorrection(db, user.id, correction.id)).toEqual({ ok: true });
    expect(await db.select().from(loanCheckpoints).where(eq(loanCheckpoints.loanId, id))).toHaveLength(1);
  });

  it("sets and clears the split of a payment, refusing what isn't a payment or exceeds it", async () => {
    const { user, item, addRow } = await setup();
    const paid = await addRow("2026-02-05", 20_000);
    const other = await addRow("2026-02-06", 5_000, null);
    const created = await createLoan(db, user.id, form({ recurringId: item.id }));
    if (!created.ok) throw new Error("create");
    const id = created.loanId;

    expect(await setLoanPaymentSplit(db, user.id, id, other, { interestCents: 1, insuranceCents: 1 })).toEqual({ ok: false, error: "notAPayment" });
    expect(await setLoanPaymentSplit(db, user.id, id, paid, { interestCents: 19_000, insuranceCents: 2_000 })).toEqual({ ok: false, error: "tooHigh" });
    expect(await setLoanPaymentSplit(db, user.id, id, paid, { interestCents: 1200, insuranceCents: 600 })).toEqual({ ok: true });
    expect((await getLoan(db, user.id, id))?.splits.get(paid)).toEqual({ interestCents: 1200, insuranceCents: 600 });
    await clearLoanPaymentSplit(db, user.id, id, paid);
    expect((await getLoan(db, user.id, id))?.splits.size).toBe(0);
  });

  it("deletes a loan with its checkpoints and splits, and Undo puts it back", async () => {
    const { user, item, addRow } = await setup();
    const paid = await addRow("2026-02-05", 20_000);
    const created = await createLoan(db, user.id, form({ recurringId: item.id }));
    if (!created.ok) throw new Error("create");
    await setLoanPaymentSplit(db, user.id, created.loanId, paid, { interestCents: 1200, insuranceCents: 600 });
    await addLoanCorrection(db, user.id, created.loanId, { date: "2026-06-01", owedCents: 900_000 });

    const snapshot = await deleteLoan(db, user.id, created.loanId);
    expect(snapshot).not.toBeNull();
    expect(await db.select().from(loans)).toEqual([]);
    expect(await db.select().from(loanCheckpoints)).toEqual([]);
    expect(await db.select().from(loanPaymentSplits)).toEqual([]);
    expect(await db.select().from(transactions)).toHaveLength(1);

    expect(await restoreLoan(db, user.id, snapshot!)).toEqual({ ok: true });
    const data = await getLoan(db, user.id, created.loanId);
    expect(data?.checkpoints).toHaveLength(2);
    expect(data?.splits.get(paid)).toEqual({ interestCents: 1200, insuranceCents: 600 });
  });

  it("keeps the loan when its regular payment is deleted, without a payment", async () => {
    const { user, item } = await setup();
    const created = await createLoan(db, user.id, form({ recurringId: item.id }));
    if (!created.ok) throw new Error("create");
    await db.delete(recurring).where(eq(recurring.id, item.id));
    const data = await getLoan(db, user.id, created.loanId);
    expect(data?.loan.recurringId).toBeNull();
    expect(data?.payments).toEqual([]);
    expect(data?.item).toBeNull();
  });

  it("finds the loan a bank row pays", async () => {
    const { user, item, addRow } = await setup();
    const paid = await addRow("2026-02-05", 20_000);
    const free = await addRow("2026-02-06", 1_000, null);
    const created = await createLoan(db, user.id, form({ recurringId: item.id }));
    if (!created.ok) throw new Error("create");
    expect((await getLoanForTransaction(db, user.id, paid))?.loan.id).toBe(created.loanId);
    expect(await getLoanForTransaction(db, user.id, free)).toBeNull();
    const stranger = await setup();
    expect(await getLoanForTransaction(db, stranger.user.id, paid)).toBeNull();
  });
});
