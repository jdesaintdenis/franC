import { and, desc, eq, isNotNull, ne } from "drizzle-orm";

import { csvMappingSchema, type CsvMapping } from "../../lib/import/mapping";
import type { db as dbClient } from "../client";
import { accounts } from "../schema";

type Executor = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];
type Database = typeof dbClient | Executor;

// Every query here is scoped by user_id: a mapping is per-user data.

/** A stored mapping that no longer validates is treated as absent, never trusted. */
function valid(stored: unknown): CsvMapping | null {
  const parsed = csvMappingSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

/** What the Columns step starts from: this account's last mapping, and the newest one on any other account. */
export async function loadMappingPrefill(
  database: Database,
  userId: string,
  accountId: string,
): Promise<{ saved: CsvMapping | null; latest: CsvMapping | null }> {
  const [own] = await database
    .select({ csvMapping: accounts.csvMapping })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  const [other] = await database
    .select({ csvMapping: accounts.csvMapping })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), ne(accounts.id, accountId), isNotNull(accounts.csvMapping)))
    .orderBy(desc(accounts.csvMappingSavedAt))
    .limit(1);
  return { saved: valid(own?.csvMapping), latest: valid(other?.csvMapping) };
}

/** Remembers the mapping for the account (a no-op when the account is not the user's). */
export async function saveMapping(database: Database, userId: string, accountId: string, mapping: CsvMapping): Promise<void> {
  await database
    .update(accounts)
    .set({ csvMapping: mapping, csvMappingSavedAt: new Date() })
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
}
