// Restores a backup file into a NEW, EMPTY database. Never reads DATABASE_URL: the target must be named
// explicitly, and a database with any row in it is refused before anything changes.
// Usage: RESTORE_DATABASE_URL=... BACKUP_AGE_IDENTITY_FILE=key.txt pnpm db:restore <file>
import { readFile } from "node:fs/promises";

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { firstFilledTable, restoreDatabase, RestoreError } from "../src/db/backup";
import { decryptBackup, parseIdentityFile, unpackArchive } from "../src/lib/backup/archive";

config({ path: ".env.local" });

async function main() {
  const file = process.argv[2];
  const url = process.env.RESTORE_DATABASE_URL;
  const identityFile = process.env.BACKUP_AGE_IDENTITY_FILE;
  if (!file) throw new Error("Usage: pnpm db:restore <backup file>");
  if (!url) throw new Error("RESTORE_DATABASE_URL is not set (a new, empty database).");
  if (!identityFile) throw new Error("BACKUP_AGE_IDENTITY_FILE is not set (path to the age-keygen key file).");

  const identity = parseIdentityFile(await readFile(identityFile, "utf8"));
  const archive = unpackArchive(await decryptBackup(await readFile(file), identity));

  const sql = postgres(url, { max: 1 });
  try {
    const filled = await firstFilledTable(sql);
    if (filled) throw new Error("Target database is not empty. Restore only into a new, empty database.");
    await migrate(drizzle(sql), { migrationsFolder: "./src/db/migrations" });

    const restored = await restoreDatabase(sql, archive);
    const total = restored.reduce((sum, r) => sum + r.rows, 0);
    console.log(`Restored ${restored.length} tables, ${total} rows (backup of ${archive.createdAt}).`);
    for (const r of restored) console.log(`${r.table}: ${r.rows}`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof RestoreError ? `Restore failed (${error.code}): ${error.message}` : `Restore failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
