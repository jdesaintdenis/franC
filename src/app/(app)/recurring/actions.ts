"use server";

import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db/client";
import { acceptPriceAlert, dismissPriceAlert } from "@/db/queries/price-alerts";
import {
  type TrackResult,
  markRecurringStillActive,
  setKeepsForNextMonth,
  refreshRecurring,
  restoreRecurring,
  setRecurringStatus,
  setRecurringStatuses,
  trackRecurring,
  untrackRecurring,
} from "@/db/queries/recurring";
import { requireUser } from "@/lib/auth/session";
import { withActionErrors } from "@/lib/actions/safe-action";
import { currentDate } from "@/lib/dashboard/month";

export type RecurringActionState = { status: "done" } | { status: "error"; error: string };

export type DetectState =
  | { status: "done"; detected: number; updated: number; removed: number }
  | { status: "error"; error: string };

function revalidateAll() {
  revalidatePath("/recurring");
  revalidatePath("/");
}

export type TrackState =
  | { status: "done"; id: string; previous: TrackResult["previous"] }
  | { status: "error"; error: string };

/** Track as regular payment: the row's payments become a confirmed item expecting their median (Slice 53). */
export async function trackRecurringAction(transactionId: string): Promise<TrackState> {
  const user = await requireUser();
  const t = await getTranslations("recurring.errors");
  const id = z.uuid().safeParse(transactionId);
  if (!id.success) return { status: "error", error: t("trackFailed") };
  const result = await trackRecurring(db, user.id, id.data);
  if (!result) return { status: "error", error: t("trackFailed") };
  revalidateTracking();
  return { status: "done", ...result };
}

const untrackSchema = z.object({
  id: z.uuid(),
  restore: z.object({ status: z.enum(["detected", "confirmed", "dismissed", "ended"]), endedAt: z.iso.date().nullable() }).nullable(),
});

/** Stop tracking, or Undo of Track: `restore` is the item's state before it was tracked. */
export async function untrackRecurringAction(input: {
  id: string;
  restore: TrackResult["previous"];
}): Promise<RecurringActionState> {
  const user = await requireUser();
  const t = await getTranslations("recurring.errors");
  const parsed = untrackSchema.safeParse(input);
  if (!parsed.success || !(await untrackRecurring(db, user.id, parsed.data.id, parsed.data.restore))) {
    return { status: "error", error: t("notFound") };
  }
  revalidateTracking();
  return { status: "done" };
}

function revalidateTracking() {
  revalidateAll();
  revalidatePath("/transactions");
  revalidatePath("/budget/next-month");
}

async function setStatus(rawId: string, status: "confirmed" | "dismissed" | "ended"): Promise<RecurringActionState> {
  const user = await requireUser();
  const NOT_FOUND = (await getTranslations("recurring.errors"))("notFound");
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { status: "error", error: NOT_FOUND };
  const endedOn = status === "ended" ? currentDate(new Date()) : undefined;
  if (!(await setRecurringStatus(db, user.id, id.data, status, endedOn))) return { status: "error", error: NOT_FOUND };

  revalidateAll();
  return { status: "done" };
}

const changesSchema = z
  .array(z.object({ id: z.uuid(), status: z.enum(["detected", "confirmed", "ended", "dismissed"]) }))
  .min(1)
  .max(200);

/**
 * Several status changes at once, all or nothing (Confirm all, and the Undo of a confirm,
 * a dismiss or an end: undoing an end is `confirmed`, which resumes the item).
 */
export async function setRecurringStatusesAction(
  changes: { id: string; status: "detected" | "confirmed" | "ended" | "dismissed" }[],
): Promise<RecurringActionState> {
  const user = await requireUser();
  const NOT_FOUND = (await getTranslations("recurring.errors"))("notFound");
  const parsed = changesSchema.safeParse(changes);
  if (!parsed.success) return { status: "error", error: NOT_FOUND };
  const endedOn = currentDate(new Date());
  const result = await setRecurringStatuses(
    db,
    user.id,
    parsed.data.map((c) => ({ ...c, endedOn: c.status === "ended" ? endedOn : undefined })),
  );
  if (!result) return { status: "error", error: NOT_FOUND };

  revalidateAll();
  return { status: "done" };
}

/** Brings a dismissed item back (Undo of a dismiss, or Restore), then relinks its transactions. */
export async function restoreRecurringAction(
  rawId: string,
  rawStatus: "detected" | "confirmed",
): Promise<RecurringActionState> {
  const user = await requireUser();
  const NOT_FOUND = (await getTranslations("recurring.errors"))("notFound");
  const id = z.uuid().safeParse(rawId);
  const status = z.enum(["detected", "confirmed"]).safeParse(rawStatus);
  if (!id.success || !status.success) return { status: "error", error: NOT_FOUND };
  if (!(await restoreRecurring(db, user.id, id.data, status.data))) return { status: "error", error: NOT_FOUND };
  await refreshRecurring(db, user.id);

  revalidateAll();
  return { status: "done" };
}

/** Confirms a detected item, or resumes an ended one. */
export async function confirmRecurringAction(id: string): Promise<RecurringActionState> {
  return setStatus(id, "confirmed");
}

/** Switches "Keep for next month" on a regular income: its charges then wait for next month in Reste à vivre. */
export async function setKeepsForNextMonthAction(rawId: string, value: boolean): Promise<RecurringActionState> {
  const user = await requireUser();
  const NOT_FOUND = (await getTranslations("recurring.errors"))("notFound");
  const parsed = z.object({ id: z.uuid(), value: z.boolean() }).safeParse({ id: rawId, value });
  if (!parsed.success) return { status: "error", error: NOT_FOUND };
  if (!(await setKeepsForNextMonth(db, user.id, parsed.data.id, parsed.data.value))) {
    return { status: "error", error: NOT_FOUND };
  }
  revalidateAll();
  return { status: "done" };
}

/** Cancelled: the item leaves every forecast until resumed or charged again. */
export async function endRecurringAction(id: string): Promise<RecurringActionState> {
  return setStatus(id, "ended");
}

/** Answers "Still active" to the "Cancelled?" flag. */
export async function stillActiveRecurringAction(rawId: string): Promise<RecurringActionState> {
  const user = await requireUser();
  const NOT_FOUND = (await getTranslations("recurring.errors"))("notFound");
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { status: "error", error: NOT_FOUND };
  if (!(await markRecurringStillActive(db, user.id, id.data))) return { status: "error", error: NOT_FOUND };

  revalidateAll();
  return { status: "done" };
}

export async function dismissRecurringAction(id: string): Promise<RecurringActionState> {
  return setStatus(id, "dismissed");
}

async function resolvePriceAlert(
  rawId: string,
  resolve: typeof acceptPriceAlert,
): Promise<RecurringActionState> {
  const user = await requireUser();
  const NOT_FOUND = (await getTranslations("recurring.errors"))("notFound");
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { status: "error", error: NOT_FOUND };
  if (!(await resolve(db, user.id, id.data))) return { status: "error", error: NOT_FOUND };

  revalidateAll();
  return { status: "done" };
}

/** Accepts the new price: it becomes the item's usual amount. */
export async function acceptPriceAlertAction(id: string): Promise<RecurringActionState> {
  return resolvePriceAlert(id, acceptPriceAlert);
}

/** Dismisses the alert for that charge only. */
export async function dismissPriceAlertAction(id: string): Promise<RecurringActionState> {
  return resolvePriceAlert(id, dismissPriceAlert);
}

/** Scans existing transactions without needing a new import. */
export async function detectRecurringNowAction(): Promise<DetectState> {
  const t = await getTranslations("recurring.detect");
  return withActionErrors(t("failed"), async (): Promise<DetectState> => {
    const user = await requireUser();
    const result = await refreshRecurring(db, user.id);
    revalidateAll();
    return { status: "done", ...result };
  });
}
