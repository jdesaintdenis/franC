import { z } from "zod";

export const ACCOUNT_NAME_MAX_LENGTH = 50;

export type AccountNameError = "required" | "tooLong";

/** Trimmed, 1-50 characters. Issue messages are error codes; the UI translates them. */
export const accountNameSchema = z
  .string()
  .trim()
  .min(1, { message: "required" })
  .max(ACCOUNT_NAME_MAX_LENGTH, { message: "tooLong" });

export type ParsedAccountName =
  | { ok: true; name: string }
  | { ok: false; error: AccountNameError };

export function parseAccountName(input: unknown): ParsedAccountName {
  const result = accountNameSchema.safeParse(input);
  if (result.success) return { ok: true, name: result.data };
  const code = result.error.issues[0]?.message;
  return { ok: false, error: code === "tooLong" ? "tooLong" : "required" };
}
