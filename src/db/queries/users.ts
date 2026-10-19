import { eq } from "drizzle-orm";

import type { Locale } from "@/i18n/config";

import { db } from "../client";
import { users } from "../schema";

/** Saves the UI language on the user's own row; `null` means follow the browser. */
export async function setUserLocale(userId: string, locale: Locale | null): Promise<void> {
  await db.update(users).set({ locale }).where(eq(users.id, userId));
}

export async function getUserLocale(userId: string): Promise<string | null> {
  const [row] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.locale ?? null;
}
