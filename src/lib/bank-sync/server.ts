import "server-only";

import { randomBytes } from "node:crypto";

import { db } from "@/db/client";
import { bankConnectionStore } from "@/db/queries/bank-connections";

import { createEnableBankingClient, type EnableBankingClient, type PsuContext } from "./client";
import { isBankSyncAllowedFor, parseEnableBankingConfig } from "./config";

export const CALLBACK_PATH = "/api/bank-sync/callback";
export const BANK_CONNECTION_PATH = "/accounts/bank";

/** The client and store, or null when bank sync isn't configured (the feature is then hidden). */
export function bankSync(): { client: EnableBankingClient; store: ReturnType<typeof bankConnectionStore> } | null {
  const config = parseEnableBankingConfig(process.env);
  if (!config) return null;
  return { client: createEnableBankingClient(config), store: bankConnectionStore(db) };
}

/** Bank sync for this user, or null when it isn't set up or the user isn't in `BANK_SYNC_EMAILS`. */
export function bankSyncFor(email: string): ReturnType<typeof bankSync> {
  return isBankSyncAllowed(email) ? bankSync() : null;
}

export function isBankSyncAllowed(email: string): boolean {
  return isBankSyncAllowedFor(process.env, email);
}

/**
 * Where the bank sends the user back: the host they started from, since their session cookie only
 * exists there (a Vercel preview has its own address). It must be registered on the Enable Banking
 * application, which is what stops a spoofed host from being used.
 */
export function callbackUrl(requestUrl: string): string {
  return new URL(CALLBACK_PATH, new URL(requestUrl).origin).toString();
}

export function newAuthState(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * The user's IP and browser, from the request that started a fetch. Enable Banking passes them to
 * the bank so the call counts as made with the user present. Null when the IP isn't known.
 */
export function psuFromHeaders(headers: Headers): PsuContext | null {
  const ipAddress = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim();
  if (!ipAddress) return null;
  return { ipAddress, userAgent: headers.get("user-agent")?.trim() || "franC" };
}
