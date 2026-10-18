import "server-only";

import { betterAuth, APIError } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { cookies, headers } from "next/headers";

import { db } from "@/db/client";
import { provisionUserDefaults } from "@/db/queries/provision";
import { authAccounts, sessions, users, verifications } from "@/db/schema";
import { defaultLocale, LOCALE_COOKIE, resolveLocale, type Locale } from "@/i18n/config";

import { isEmailAllowed } from "./allowlist";

/** The language of the sign-up page (cookie, then browser); English outside a request. */
async function signUpLocale(): Promise<Locale> {
  try {
    const [jar, h] = await Promise.all([cookies(), headers()]);
    return resolveLocale({ cookie: jar.get(LOCALE_COOKIE)?.value, acceptLanguage: h.get("accept-language") });
  } catch {
    return defaultLocale;
  }
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  // On Vercel production, fall back to the project's production domain so a fresh deploy needs no BETTER_AUTH_URL.
  baseURL:
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined),
  database: drizzleAdapter(db, {
    provider: "pg",
    // The `schema` keys below must match the `modelName`s configured just
    // underneath — Better Auth looks the Drizzle table up in this object by
    // the *custom* model name, not its own default ("user", "account", …).
    schema: {
      users,
      sessions,
      authAccounts,
      verifications,
    },
  }),
  // Better Auth's default model names (user/session/account/verification)
  // are remapped to our table names because our own `accounts` table is
  // already bank accounts, not login accounts (see src/db/schema.ts).
  user: {
    modelName: "users",
    // UI language and colour theme; server-managed (see the setLocale and
    // setTheme actions), never user input.
    additionalFields: {
      locale: { type: "string", required: false, input: false },
      theme: { type: "string", required: false, input: false },
    },
  },
  session: {
    modelName: "sessions",
  },
  account: {
    modelName: "authAccounts",
  },
  verification: {
    modelName: "verifications",
  },
  emailAndPassword: {
    enabled: true,
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Read the allowlist at call time (not at module load) so tests
          // can set ALLOWED_EMAILS before calling the auth API.
          if (!isEmailAllowed(user.email, process.env.ALLOWED_EMAILS)) {
            throw new APIError("FORBIDDEN", {
              message: "Sign-up is not allowed for this email",
            });
          }
        },
        after: async (user) => {
          await provisionUserDefaults(db, user.id, await signUpLocale());
        },
      },
    },
  },
  // Must be last: it lets server actions set the session cookie directly.
  plugins: [nextCookies()],
});
