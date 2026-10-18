import { eq, sql } from "drizzle-orm";

import type { db as dbClient } from "@/db/client";
import { backupStatus } from "@/db/schema";

type Database = typeof dbClient;

export interface BackupRunInput {
  at: Date;
  error: string | null;
  pathname?: string;
  sizeBytes?: number;
}

/** Keeps the start of the current run of failures; a success clears it. */
export async function recordBackupRun(database: Database, input: BackupRunInput): Promise<void> {
  const { at, error } = input;
  if (error === null) {
    const values = {
      lastAttemptAt: at,
      lastSuccessAt: at,
      lastError: null,
      failingSince: null,
      lastPathname: input.pathname ?? null,
      lastSizeBytes: input.sizeBytes ?? null,
    };
    await database.insert(backupStatus).values({ id: 1, ...values }).onConflictDoUpdate({ target: backupStatus.id, set: values });
    return;
  }
  await database
    .insert(backupStatus)
    .values({ id: 1, lastAttemptAt: at, lastError: error, failingSince: at })
    .onConflictDoUpdate({
      target: backupStatus.id,
      set: {
        lastAttemptAt: at,
        lastError: error,
        failingSince: sql`coalesce(${backupStatus.failingSince}, ${at.toISOString()}::timestamptz)`,
      },
    });
}

export async function getBackupStatus(
  database: Database,
): Promise<{ failingSince: Date | null; lastSuccessAt: Date | null } | null> {
  const [row] = await database
    .select({ failingSince: backupStatus.failingSince, lastSuccessAt: backupStatus.lastSuccessAt })
    .from(backupStatus)
    .where(eq(backupStatus.id, 1));
  return row ?? null;
}
