import { eq } from "drizzle-orm";

import type { Locale } from "@/i18n/config";
import type { IncomeMonth } from "@/lib/safe-to-spend/compute";

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

/** Which month Reste à vivre counts incoming money for; anything but "this" reads as the default "next". */
export async function getIncomeMonth(userId: string): Promise<IncomeMonth> {
  const [row] = await db.select({ incomeMonth: users.incomeMonth }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.incomeMonth === "this" ? "this" : "next";
}

export async function setIncomeMonth(userId: string, incomeMonth: IncomeMonth): Promise<void> {
  await db.update(users).set({ incomeMonth }).where(eq(users.id, userId));
}
