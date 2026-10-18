"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { APIError } from "better-auth";
import { getTranslations } from "next-intl/server";

import { redactError } from "@/lib/logging/redact";
import { auth } from "@/lib/auth/server";
import { safeNextPath } from "@/lib/auth/safe-next-path";

export type AuthFormState = { error: string } | undefined;

// No messages here: they are shown to users, so they are chosen per field in
// the action, where the locale is known.
const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export async function login(_prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const t = await getTranslations("auth.errors");
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: t("invalidCredentials") };
  }

  const next = safeNextPath(formData.get("next")?.toString());

  try {
    await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    });
  } catch (err) {
    // Better Auth answers 401 for both "no such user" and "wrong password";
    // we never distinguish them. Anything else is an outage or rate limit.
    if (err instanceof APIError && err.statusCode === 401) {
      return { error: t("invalidCredentials") };
    }
    if (err instanceof APIError && err.statusCode === 429) {
      return { error: t("rateLimit") };
    }
    console.error("Login failed unexpectedly", redactError(err));
    return { error: (await getTranslations("common.errors"))("generic") };
  }

  redirect(next);
}

export async function signup(_prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const t = await getTranslations("auth.errors");
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    // Signup is where the user picks the password, so tell them what to fix.
    const field = parsed.error.issues[0]?.path[0];
    return {
      error: field === "email" ? t("invalidEmail") : field === "password" ? t("passwordTooShort") : t("invalidInput"),
    };
  }

  try {
    await auth.api.signUpEmail({
      body: { email: parsed.data.email, password: parsed.data.password, name: parsed.data.email },
      headers: await headers(),
    });
  } catch (err) {
    if (err instanceof APIError && err.status === "FORBIDDEN") {
      return { error: t("signupForbidden") };
    }
    if (err instanceof APIError && err.statusCode === 429) {
      return { error: t("rateLimit") };
    }
    console.error("Signup failed unexpectedly", redactError(err));
    return { error: t("signupFailed") };
  }

  redirect("/");
}
