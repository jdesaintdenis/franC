"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db/client";
import {
  createManualTransaction,
  deleteManualTransaction,
  linkManualToBankRow,
  listLinkCandidates,
  setAwaitingBank,
  updateManualTransaction,
  type LinkCandidate,
  type ManualSnapshot,
} from "@/db/queries/manual-transactions";
import { refreshDerivedData } from "@/lib/actions/refresh-derived";
import { requireUser } from "@/lib/auth/session";
import { zonedIsoDay } from "@/lib/format-date";
import { MANUAL_LABEL_MAX, parseManualForm, type ManualFormError } from "@/lib/manual/input";

/** Codes, not copy: the sheets translate them (`transactions.add.errors.*`). */
export type ManualErrorCode = ManualFormError | "invalidInput" | "notFound" | "notCurrent" | "isSplit" | "isTransfer";
type Failure = { status: "error"; error: ManualErrorCode };

const formFields = {
  direction: z.enum(["expense", "income"]),
  amount: z.string().max(40),
  label: z.string().max(MANUAL_LABEL_MAX * 3),
  date: z.string().max(10),
};

async function afterChange(userId: string) {
  // Detection (transfers, recurring) reads every countable row, hand-added ones too.
  await refreshDerivedData(userId, "manualChange");
  revalidatePath("/", "layout");
}

const createInput = z.object({
  accountId: z.uuid(),
  categoryId: z.uuid().nullable(),
  ...formFields,
});

/** Adds a transaction by hand to a Current account. */
export async function createManualTransactionAction(
  input: unknown,
): Promise<{ status: "done"; id: string; awaitingBank: boolean } | Failure> {
  const user = await requireUser();
  const parsed = createInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };
  const form = parseManualForm(parsed.data, { today: zonedIsoDay(new Date()) });
  if (!form.ok) return { status: "error", error: form.error };

  const result = await createManualTransaction(db, user.id, {
    ...form.value,
    accountId: parsed.data.accountId,
    categoryId: parsed.data.categoryId,
  });
  if (!result.ok) return { status: "error", error: result.error };
  await afterChange(user.id);
  return { status: "done", id: result.id, awaitingBank: result.awaitingBank };
}

const updateInput = z.object({ id: z.uuid(), ...formFields });

/** Edits a transaction added by hand. */
export async function updateManualTransactionAction(input: unknown): Promise<{ status: "done" } | Failure> {
  const user = await requireUser();
  const parsed = updateInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };
  const form = parseManualForm(parsed.data, { today: zonedIsoDay(new Date()) });
  if (!form.ok) return { status: "error", error: form.error };

  const result = await updateManualTransaction(db, user.id, parsed.data.id, form.value);
  if (!result.ok) return { status: "error", error: result.error };
  await afterChange(user.id);
  return { status: "done" };
}

const idInput = z.object({ id: z.uuid() });

/** Deletes a transaction added by hand; the snapshot is what Undo sends back. */
export async function deleteManualTransactionAction(
  input: unknown,
): Promise<{ status: "done"; snapshot: ManualSnapshot } | Failure> {
  const user = await requireUser();
  const parsed = idInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const snapshot = await deleteManualTransaction(db, user.id, parsed.data.id);
  if (!snapshot) return { status: "error", error: "notFound" };
  await afterChange(user.id);
  return { status: "done", snapshot };
}

const snapshotInput = z.object({
  accountId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int().min(-1_000_000_000).max(1_000_000_000).refine((n) => n !== 0),
  label: z.string().trim().min(1).max(MANUAL_LABEL_MAX),
  categoryId: z.uuid().nullable(),
  categorySource: z.enum(["manual", "rule", "bank", "guess"]).nullable(),
  note: z.string().max(2000).nullable(),
  tagIds: z.array(z.uuid()).max(50),
});

/** Undo of a delete: puts the row back (new id; splits and links are not restored). */
export async function restoreManualTransactionAction(
  input: unknown,
): Promise<{ status: "done"; id: string; awaitingBank: boolean } | Failure> {
  const user = await requireUser();
  const parsed = snapshotInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const result = await createManualTransaction(db, user.id, parsed.data);
  if (!result.ok) return { status: "error", error: result.error };
  await afterChange(user.id);
  return { status: "done", id: result.id, awaitingBank: result.awaitingBank };
}

const waitInput = z.object({ id: z.uuid(), waiting: z.boolean() });

/** Keep (`waiting: false`) or, for its Undo, wait for the bank again (`waiting: true`). */
export async function setManualWaitingAction(input: unknown): Promise<{ status: "done" } | Failure> {
  const user = await requireUser();
  const parsed = waitInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  if (!(await setAwaitingBank(db, user.id, parsed.data.id, parsed.data.waiting))) {
    return { status: "error", error: "notFound" };
  }
  revalidatePath("/", "layout");
  return { status: "done" };
}

/** Bank rows a not-found row could be (Same as…). */
export async function listLinkCandidatesAction(
  input: unknown,
): Promise<{ status: "done"; candidates: LinkCandidate[] } | Failure> {
  const user = await requireUser();
  const parsed = idInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };
  return { status: "done", candidates: await listLinkCandidates(db, user.id, parsed.data.id) };
}

const linkInput = z.object({ manualId: z.uuid(), bankRowId: z.uuid() });

/** Same as…: the not-found row is that bank row. */
export async function linkManualToBankRowAction(input: unknown): Promise<{ status: "done" } | Failure> {
  const user = await requireUser();
  const parsed = linkInput.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalidInput" };

  const result = await linkManualToBankRow(db, user.id, parsed.data.manualId, parsed.data.bankRowId);
  if (!result.ok) return { status: "error", error: result.error };
  await afterChange(user.id);
  return { status: "done" };
}
