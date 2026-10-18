import crypto from "node:crypto";

import { isEmailAllowed } from "../auth/allowlist";

export type EnableBankingConfig = {
  appId: string;
  privateKey: crypto.KeyObject;
  apiOrigin: string;
};

const DEFAULT_API_ORIGIN = "https://api.enablebanking.com";

/** Env-var UIs handle multi-line values differently, so accept PEM, PEM with literal \n, or base64 of the PEM. */
function normalizePem(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("-----BEGIN")) return trimmed.replace(/\\n/g, "\n");
  return Buffer.from(trimmed, "base64").toString("utf8").trim();
}

function parseOrigin(raw: string | undefined): string | null {
  const value = raw?.trim() || DEFAULT_API_ORIGIN;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return value.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Enable Banking settings from the environment, or null when bank sync is not (fully, validly) configured. */
export function parseEnableBankingConfig(
  env: Record<string, string | undefined>,
): EnableBankingConfig | null {
  const appId = env.ENABLE_BANKING_APP_ID?.trim();
  const rawKey = env.ENABLE_BANKING_PRIVATE_KEY;
  if (!appId || !rawKey?.trim()) return null;
  const apiOrigin = parseOrigin(env.ENABLE_BANKING_API_ORIGIN);
  if (!apiOrigin) return null;
  try {
    const privateKey = crypto.createPrivateKey(normalizePem(rawKey));
    return { appId, privateKey, apiOrigin };
  } catch {
    return null;
  }
}

export function isBankSyncEnabled(env: Record<string, string | undefined>): boolean {
  return parseEnableBankingConfig(env) !== null;
}

/**
 * Whether this user gets bank sync. Restricted mode reads the app owner's linked accounts, so the
 * feature is limited to `BANK_SYNC_EMAILS` (comma-separated); unset means nobody.
 */
export function isBankSyncAllowedFor(env: Record<string, string | undefined>, email: string): boolean {
  return isEmailAllowed(email, env.BANK_SYNC_EMAILS) && parseEnableBankingConfig(env) !== null;
}
