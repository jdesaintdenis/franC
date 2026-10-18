import { eq } from "drizzle-orm";

import type { db as dbClient } from "../client";
import type { Locale } from "../../i18n/config";
import { DEFAULT_ACCOUNT_NAMES } from "../../lib/categorize/default-categories";
import { accounts } from "../schema";

/**
 * Idempotent per-user seeding: one default bank account. Categories are not
 * seeded: they are created from the bank's categories at import (Slice 14).
 * Safe to call every time a user signs in. The account is named in `locale`.
 */
export async function provisionUserDefaults(
  database: typeof dbClient,
  userId: string,
  locale: Locale = "en",
): Promise<void> {
  await database.transaction(async (tx) => {
    const existingAccount = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .limit(1);

    if (existingAccount.length === 0) {
      await tx.insert(accounts).values({ userId, name: DEFAULT_ACCOUNT_NAMES[locale] });
    }
  });
}
