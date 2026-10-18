import { z } from "zod";

const accountParamSchema = z.string().uuid();

/**
 * The `?account=` param as one of the user's own account ids, or null (= all
 * accounts) when missing, malformed or not theirs. Ignoring a foreign id, like
 * an invalid `category`, keeps a bad link rendering the full view.
 */
export function parseAccountParam(value: unknown, ownAccountIds: readonly string[]): string | null {
  const parsed = accountParamSchema.safeParse(value);
  return parsed.success && ownAccountIds.includes(parsed.data) ? parsed.data : null;
}

/** `?account=all`: all accounts even when a default Home account is set. */
export const ALL_ACCOUNTS = "all";

/**
 * Home's account scope. No `?account=` opens the default Home account; `?account=all` or an
 * invalid value shows all accounts. `linkParam` is what Home's own links must carry to keep the
 * same scope: "all" when all accounts are shown over a default, else the account id (or nothing).
 */
export function resolveHomeAccount(
  param: unknown,
  homeAccountId: string | null,
  ownAccountIds: readonly string[],
): { accountId: string | null; linkParam: string | null } {
  const accountId = parseAccountParam(param === undefined ? homeAccountId : param, ownAccountIds);
  const hasDefault = homeAccountId !== null && ownAccountIds.includes(homeAccountId);
  return { accountId, linkParam: accountId ?? (hasDefault ? ALL_ACCOUNTS : null) };
}
