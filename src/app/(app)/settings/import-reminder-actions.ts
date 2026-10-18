"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db/client";
import { setImportReminderDays } from "@/db/queries/import-reminder";
import { withActionErrors } from "@/lib/actions/safe-action";
import { requireUser } from "@/lib/auth/session";
import { MAX_REMINDER_DAYS, MIN_REMINDER_DAYS } from "@/lib/import-reminder/staleness";

// null = reminder off.
const daysSchema = z.number().int().min(MIN_REMINDER_DAYS).max(MAX_REMINDER_DAYS).nullable();

export type SetImportReminderResult = { status: "ok" } | { status: "error"; error: string };

/**
 * Saves the reminder threshold ("after N days without new data"); null turns the reminder off.
 * The error text is a generic fallback; the UI shows its own translated message.
 */
export async function setImportReminderDaysAction(value: unknown): Promise<SetImportReminderResult> {
  const parsed = daysSchema.safeParse(value);
  if (!parsed.success) return { status: "error", error: "Invalid number of days." };

  const user = await requireUser();
  return withActionErrors("Could not save the import reminder.", async (): Promise<SetImportReminderResult> => {
    await setImportReminderDays(db, user.id, parsed.data);
    // The dashboard banner depends on it.
    revalidatePath("/", "layout");
    return { status: "ok" };
  });
}
