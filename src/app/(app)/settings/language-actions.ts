"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { setUserLocale } from "@/db/queries/users";
import { withActionErrors } from "@/lib/actions/safe-action";
import { requireUser } from "@/lib/auth/session";
import { LOCALE_COOKIE, type Locale } from "@/i18n/config";

const inputSchema = z.enum(["en", "fr", "auto"]);

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export type SetLocaleResult = { status: "ok"; locale: Locale | "auto" } | { status: "error"; error: string };

/**
 * Saves the language on the user ("auto" clears it) and mirrors it in a cookie
 * so logged-out pages (login) follow the same choice. The error text is a
 * generic fallback; the UI should show its own translated message on "error".
 */
export async function setLocale(value: unknown): Promise<SetLocaleResult> {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) return { status: "error", error: "Invalid language." };

  const user = await requireUser();
  const choice = parsed.data;

  const result = await withActionErrors("Could not save the language.", async (): Promise<SetLocaleResult> => {
    await setUserLocale(user.id, choice === "auto" ? null : choice);
    return { status: "ok", locale: choice };
  });
  if (result.status === "error") return result;

  const jar = await cookies();
  if (choice === "auto") {
    jar.delete(LOCALE_COOKIE);
  } else {
    jar.set(LOCALE_COOKIE, choice, {
      maxAge: ONE_YEAR_SECONDS,
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
    });
  }

  revalidatePath("/", "layout");
  return result;
}
